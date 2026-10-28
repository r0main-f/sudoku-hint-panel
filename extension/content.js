// Sudoku Hint Panel — content script (not affiliated with Easybrain / sudoku.com)
// Reads the live game from localStorage (sudoku.com saves it on every move)
// and drives the game with the same inputs a player uses: clicking a cell,
// toggling the pencil, pressing a digit key.
(() => {
  'use strict';
  if (window.__sdkhLoaded) return;
  window.__sdkhLoaded = true;

  const STEP_DELAY = 15; // ms between simulated inputs
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- units & peers
  const range9 = [...Array(9).keys()];
  const UNITS = [
    ...range9.map((r) => ({ name: `row ${r + 1}`, cells: range9.map((c) => r * 9 + c) })),
    ...range9.map((c) => ({ name: `column ${c + 1}`, cells: range9.map((r) => r * 9 + c) })),
    ...range9.map((b) => {
      const br = Math.floor(b / 3) * 3, bc = (b % 3) * 3;
      return { name: `box ${b + 1}`, cells: range9.map((k) => (br + Math.floor(k / 3)) * 9 + bc + (k % 3)) };
    }),
  ];
  const PEERS = Array.from({ length: 81 }, (_, i) => {
    const s = new Set();
    for (const u of UNITS) if (u.cells.includes(i)) u.cells.forEach((j) => s.add(j));
    s.delete(i);
    return [...s];
  });
  const cellName = (i) => `r${Math.floor(i / 9) + 1}c${(i % 9) + 1}`;

  // ---------------------------------------------------------------- state
  function pageInfo() {
    const ds = document.documentElement.dataset;
    const type = ds.sdkhType || (location.pathname.includes('killer') ? 'killer' : 'classic');
    return { mode: ds.sdkhMode || 'main', type, id: ds.sdkhId || '' };
  }

  // The puzzle captured by page-bridge.js, if it is newer than the last save
  // and is not the saved game.
  function newLevel(page, saved) {
    if (page.mode !== 'main') return null;
    let lv;
    try { lv = JSON.parse(document.documentElement.dataset.sdkhLevel || 'null'); } catch (e) { return null; }
    if (!lv || lv.type !== page.type || !/^\d{81}$/.test(lv.mission)) return null;
    if (saved && String(saved.id) === String(lv.id)) return null;          // already saved
    const lastSave = Number(document.documentElement.dataset.sdkhSaveT || 0);
    if (lastSave > lv.t) return null;                                      // saved since: saved game wins
    return lv;
  }

  function levelState(lv) {
    return {
      raw: 'level:' + lv.id,
      grid: lv.mission.split('').map(Number),
      mistake: Array(81).fill(false),
      notes: Array.from({ length: 81 }, () => new Set()),
    };
  }

  function toState(raw, g) {
    return {
      raw,
      grid: g.values.map((v) => Number(v.val) || 0),
      mistake: g.values.map((v) => !!v.mistake),
      notes: Array.from({ length: 81 }, (_, i) =>
        new Set(((g.notes && g.notes[i]) || []).filter((x) => x >= 1 && x <= 9))),
    };
  }

  function readState() {
    const page = pageInfo();
    if (page.mode !== 'main') return readSpecialState(page);

    const key = page.type === 'killer' ? 'main_game_killer' : 'main_game';
    const raw = localStorage.getItem(key);
    let g = null;
    if (raw) {
      try { g = JSON.parse(raw); } catch (e) { g = null; }
      if (g && (!Array.isArray(g.values) || g.values.length !== 81 || (g.mode && g.mode !== page.type))) g = null;
    }

    // A new puzzle was just loaded and the game hasn't saved it yet (it saves
    // on the first move): use the puzzle's starting grid until it does.
    const level = newLevel(page, g);
    if (level) return levelState(level);
    if (!raw) return { error: `No ${page.type} game found yet.` };
    if (!g) return { error: 'Could not read the game state.' };
    return toState(raw, g);
  }

  // ---- special editions (storybook, postcards, other events…) ------------
  // They save each level inside a bigger record (e.g. storybook.levelsMap[n]
  // .levelProgress). Find the saved game whose id is the puzzle on screen.
  const storeCache = new Map(); // localStorage key -> { raw, hits }
  const SPECIAL_KEYS = /storybook|postcard|event|daily|dc_|level|game/i;

  function collectGames(o, path, depth, hits) {
    if (!o || typeof o !== 'object' || depth > 8) return;
    if (Array.isArray(o.values) && o.values.length === 81 && o.id != null) {
      hits.push({ obj: o, start: /start/i.test(path) });
      return;
    }
    for (const k of Object.keys(o)) collectGames(o[k], path + '.' + k, depth + 1, hits);
  }

  function findGameById(id) {
    let best = null;
    for (const k of Object.keys(localStorage)) {
      if (/^main_game/.test(k) || !SPECIAL_KEYS.test(k)) continue;
      const raw = localStorage.getItem(k);
      if (!raw || (raw[0] !== '{' && raw[0] !== '[')) continue;
      let c = storeCache.get(k);
      if (!c || c.raw !== raw) {
        c = { raw, hits: [] };
        try { collectGames(JSON.parse(raw), k, 0, c.hits); } catch (e) { /* ignore */ }
        storeCache.set(k, c);
      }
      for (const h of c.hits) {
        if (String(h.obj.id) !== id) continue;
        if (!best || (best.start && !h.start)) best = h;   // live progress beats the starting copy
      }
    }
    return best && best.obj;
  }

  function readSpecialState(page) {
    let lv = null;
    try { lv = JSON.parse(document.documentElement.dataset.sdkhLevel || 'null'); } catch (e) { lv = null; }
    if (lv && !/^\d{81}$/.test(lv.mission)) lv = null;
    // the most recently loaded puzzle is the one on screen; otherwise the page's own id
    const id = lv ? String(lv.id) : page.id;
    if (!id) return { error: 'Can’t tell which puzzle is on screen yet.' };
    const g = findGameById(id);
    if (g) return toState(JSON.stringify(g), g);
    if (lv) return levelState(lv);            // just loaded, nothing saved yet
    return { error: 'This game isn’t saved where the helper can read it (yet).' };
  }

  function candidates(grid) {
    return grid.map((v, i) => {
      if (v) return null;
      const s = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const p of PEERS[i]) s.delete(grid[p]);
      return s;
    });
  }

  // The player's notes count only once every empty cell has notes (e.g. after
  // "Fill all candidates"). Then each erased note narrows the candidates, so the
  // next single / pair / pointing cell appears. Partial notes are ignored.
  function notesComplete(st) {
    let empty = 0;
    for (let i = 0; i < 81; i++) if (!st.grid[i]) { empty++; if (!st.notes[i].size) return false; }
    return empty > 0;
  }

  function effectiveCands(st) {
    const raw = candidates(st.grid);
    if (!notesComplete(st)) return raw;
    return raw.map((c, i) => (c && st.notes[i].size ? new Set([...c].filter((d) => st.notes[i].has(d))) : c));
  }

  // Naked pairs / triples: N cells of one unit whose candidates together are
  // exactly N digits. Those digits can be erased from the unit's other cells.
  // Only groups that still erase something are returned.
  function findSubsets(cand) {
    const byKey = new Map();
    for (const u of UNITS) {
      const open = u.cells.filter((i) => cand[i] && cand[i].size >= 2 && cand[i].size <= 3);
      const pairCells = new Set();

      const consider = (cs, kind) => {
        const union = new Set();
        cs.forEach((i) => cand[i].forEach((d) => union.add(d)));
        if (union.size !== cs.length) return false;
        const key = cs.join(',');
        let g = byKey.get(key);
        if (!g) {
          g = { kind, cells: cs, digits: [...union].sort(), units: [], elims: new Map() };
          byKey.set(key, g);
        }
        g.units.push(u.name);
        for (const j of u.cells) {
          if (cs.includes(j) || !cand[j]) continue;
          const ds = g.digits.filter((d) => cand[j].has(d));
          if (ds.length) g.elims.set(j, [...new Set([...(g.elims.get(j) || []), ...ds])].sort());
        }
        return true;
      };

      for (let a = 0; a < open.length; a++)
        for (let b = a + 1; b < open.length; b++)
          if (consider([open[a], open[b]], 'pair')) pairCells.add(open[a] + ',' + open[b]);

      for (let a = 0; a < open.length; a++)
        for (let b = a + 1; b < open.length; b++)
          for (let c = b + 1; c < open.length; c++) {
            const [x, y, z] = [open[a], open[b], open[c]];
            // skip triples that merely contain a pair already found here
            if (pairCells.has(x + ',' + y) || pairCells.has(x + ',' + z) || pairCells.has(y + ',' + z)) continue;
            consider([x, y, z], 'triple');
          }
    }
    return [...byKey.values()]
      .filter((g) => g.elims.size)
      .sort((p, q) => p.cells.length - q.cells.length || p.cells[0] - q.cells[0]);
  }

  // Pointing: inside one box, every candidate cell for digit d lies in a
  // single row (or column). d must then go in the box's part of that line, so
  // it can be erased from the rest of the line, outside the box.
  function findPointing(cand) {
    const out = [];
    for (let b = 0; b < 9; b++) {
      const box = UNITS[18 + b];
      for (let d = 1; d <= 9; d++) {
        const cs = box.cells.filter((i) => cand[i] && cand[i].has(d));
        if (cs.length < 2) continue; // 1 cell = a hidden single, not pointing
        for (const [base, lineOf] of [[0, (i) => Math.floor(i / 9)], [9, (i) => i % 9]]) {
          const k = lineOf(cs[0]);
          if (!cs.every((i) => lineOf(i) === k)) continue;
          const line = UNITS[base + k];
          const elims = new Map();
          for (const j of line.cells) {
            if (box.cells.includes(j) || !cand[j] || !cand[j].has(d)) continue;
            elims.set(j, [d]);
          }
          if (elims.size) out.push({ kind: 'pointing', cells: cs, digits: [d], units: [`${box.name} → ${line.name}`], elims });
        }
      }
    }
    return out;
  }

  // Chained analysis. Every erasure a hint allows is applied to a working copy
  // of the candidates, then the search runs again, until nothing new appears.
  // So a pointing pair that only exists once another hint's erasures are done
  // (e.g. box 6's 7s point along row 4 → box 5's 7s now point along row 6) is
  // found too. Each hint records the earlier hints it relies on (deps) and its
  // step (1 = visible on the board as it is).
  //
  // Returns {
  //   singles: [{ i, d, kind: 'naked'|'hidden', unit, step, deps }],
  //   dead: [idx], subsets: [group], pointing: [group]   (group.step, group.deps)
  // }
  function analyse(st) {
    const cand0 = effectiveCands(st);
    const cand = cand0.map((c) => (c ? new Set(c) : null));
    const hints = [];                  // groups in discovery order
    const removedBy = new Map();       // "cell:digit" -> index in hints
    const seen = new Set();

    const depsOf = (pairs) => {        // pairs: [[cell, digit]] whose removal mattered
      const out = new Set();
      for (const [j, d] of pairs) { const h = removedBy.get(j + ':' + d); if (h != null) out.add(h); }
      return [...out];
    };
    const stepOf = (deps) => (deps.length ? 1 + Math.max(...deps.map((h) => hints[h].step)) : 1);

    for (let round = 0; round < 15; round++) {
      const found = [...findSubsets(cand), ...findPointing(cand)].filter((g) => {
        const key = g.kind + ':' + g.cells.join(',') + ':' + g.digits.join('');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!found.length) break;
      for (const g of found) {         // deps from earlier rounds only
        let pairs;
        if (g.kind === 'pointing') {   // the digit was erased from the box's other lines
          const box = UNITS.find((u) => u.name === g.units[0].split(' → ')[0]);
          pairs = box.cells.map((j) => [j, g.digits[0]]);
        } else {                       // the group's cells lost other candidates
          pairs = g.cells.flatMap((i) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => [i, d]));
        }
        g.deps = depsOf(pairs);
        g.step = stepOf(g.deps);
      }
      let progressed = false;
      for (const g of found) {
        const idx = hints.push(g) - 1;
        for (const [j, ds] of g.elims) {
          for (const d of ds) {
            if (!cand[j].has(d)) continue;
            cand[j].delete(d);
            if (!removedBy.has(j + ':' + d)) removedBy.set(j + ':' + d, idx);
            progressed = true;
          }
        }
      }
      if (!progressed) break;
    }

    // Single options on the reduced candidates:
    //  naked  = a cell with one possible digit;
    //  hidden = a digit with one possible cell in a row, column or box.
    const singles = [], dead = [], taken = new Set();
    for (let i = 0; i < 81; i++) {
      if (st.grid[i]) continue;
      if (cand0[i].size === 0) { dead.push(i); continue; }
      if (cand[i].size === 1) {
        const d = [...cand[i]][0];
        const deps = depsOf([1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => [i, x]));
        singles.push({ i, d, kind: 'naked', unit: '', deps, step: stepOf(deps) });
        taken.add(i);
      }
    }
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        if (u.cells.some((i) => st.grid[i] === d)) continue;
        const places = u.cells.filter((i) => cand[i] && cand[i].has(d));
        if (places.length !== 1 || taken.has(places[0])) continue;
        const i = places[0];
        const deps = depsOf(u.cells.map((j) => [j, d]));
        singles.push({ i, d, kind: 'hidden', unit: u.name, deps, step: stepOf(deps) });
        taken.add(i);
      }
    }
    singles.sort((p, q) => p.step - q.step || p.i - q.i);

    // stable order for the lists: by step, then position
    const order = (p, q) => p.step - q.step || p.cells[0] - q.cells[0];
    const subsets = hints.filter((g) => g.kind !== 'pointing').sort(order);
    const pointing = hints.filter((g) => g.kind === 'pointing').sort(order);
    return { cand: cand0, singles, dead, subsets, pointing, hints, removedBy, usesNotes: notesComplete(st) };
  }

  // ---------------------------------------------------------------- input
  const canvas = () => document.querySelector('#game canvas');

  // ---------------------------------------------------------------- board geometry
  // sudoku.com draws a thick outer border and thick 3x3 box lines, so cells do
  // not sit on exact ninths of the canvas. Read where those dark lines are (one
  // pixel row and one column just inside the top-left cell) and split each box
  // into three. Falls back to even ninths if the lines can't be read.
  const UNIFORM = Array.from({ length: 9 }, (_, k) => [k / 9, (k + 1) / 9]);
  let geom = { key: '', t: 0, cols: UNIFORM, rows: UNIFORM };
  function darkRuns(data, n) {
    const runs = [];
    let s0 = -1;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const dk = data[o + 3] > 200 && data[o] + data[o + 1] + data[o + 2] < 330;
      if (dk && s0 < 0) s0 = i;
      if (!dk && s0 >= 0) { runs.push([s0, i - 1]); s0 = -1; }
    }
    if (s0 >= 0) runs.push([s0, n - 1]);
    return runs;
  }
  function spans(runs, n) {
    if (runs.length !== 4 || runs[0][0] > n * 0.02 || runs[3][1] < n * 0.98) return null;
    if (runs.some(([a, b]) => b - a > n * 0.03)) return null;
    const out = [];
    for (let b = 0; b < 3; b++) {
      const a = runs[b][1] + 1, z = runs[b + 1][0], w = (z - a) / 3;
      for (let k = 0; k < 3; k++) out.push([(a + k * w) / n, (a + (k + 1) * w) / n]);
    }
    return out;
  }
  function boardGeometry(cv) {
    const key = cv.width + 'x' + cv.height;
    if (geom.key === key && Date.now() - geom.t < 5000) return geom;
    let cols = null, rows = null;
    try {
      const ctx = cv.getContext('2d');
      if (ctx) {
        const W = cv.width, H = cv.height;
        cols = spans(darkRuns(ctx.getImageData(0, Math.round(H * 0.012), W, 1).data, W), W);
        rows = spans(darkRuns(ctx.getImageData(Math.round(W * 0.012), 0, 1, H).data, H), H);
      }
    } catch (e) { /* unreadable canvas: keep even ninths */ }
    geom = { key, t: Date.now(), cols: cols || UNIFORM, rows: rows || UNIFORM };
    return geom;
  }
  // a cell's rectangle in page pixels
  function cellBox(i, r, g) {
    const [x0, x1] = g.cols[i % 9], [y0, y1] = g.rows[Math.floor(i / 9)];
    return { x: r.left + x0 * r.width, y: r.top + y0 * r.height, w: (x1 - x0) * r.width, h: (y1 - y0) * r.height };
  }
  const pencilBtn = () => document.querySelector('.game-controls-pencil');
  const undoBtn = () => document.querySelector('.game-controls-undo');

  function mouse(el, type, x, y) {
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
      buttons: type.endsWith('down') ? 1 : 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, o) : new MouseEvent(type, o));
  }

  function pressControl(el) {
    const r = el.getBoundingClientRect();
    mouse(el, 'mousedown', r.left + r.width / 2, r.top + r.height / 2);
    mouse(el, 'mouseup', r.left + r.width / 2, r.top + r.height / 2);
  }

  function selectCell(i) {
    const cv = canvas();
    const r = cv.getBoundingClientRect(), b = cellBox(i, r, boardGeometry(cv));
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) mouse(cv, t, x, y);
  }

  function pressDigit(d) {
    const o = { key: String(d), code: 'Digit' + d, keyCode: 48 + d, which: 48 + d, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent('keydown', o));
    document.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  function pencilOn() {
    const el = pencilBtn();
    if (!el) return false;
    const txt = getComputedStyle(el, '::after').content.replace(/["']/g, '').trim();
    return /^on$/i.test(txt);
  }

  async function setPencil(on) {
    if (pencilOn() === on) return true;
    pressControl(pencilBtn());
    await sleep(80);
    return pencilOn() === on;
  }

  async function waitForChange(prevRaw, timeout = 800) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const st = readState();
      if (!st.error && st.raw !== prevRaw) return st;
      await sleep(25);
    }
    return null;
  }

  // ---------------------------------------------------------------- actions
  let busy = false;

  async function run(fn) {
    if (busy) return;
    if (!canvas() || !pencilBtn()) return status('No game board on this page.', 'err');
    busy = true;
    panel.classList.add('sdkh-busy');
    try { await fn(); } catch (e) { status('Error: ' + e.message, 'err'); }
    finally { busy = false; panel.classList.remove('sdkh-busy'); render(true); }
  }

  async function fillCandidates() {
    const st = readState();
    if (st.error) return status(st.error, 'err');
    const cand = candidates(st.grid);
    const jobs = [];
    for (let i = 0; i < 81; i++) {
      if (st.grid[i]) continue;
      const toggles = [];
      for (let d = 1; d <= 9; d++) if (cand[i].has(d) !== st.notes[i].has(d)) toggles.push(d);
      if (toggles.length) jobs.push([i, toggles]);
    }
    if (!jobs.length) return status('Candidates are already complete.', 'ok');

    const wasOn = pencilOn();
    if (!(await setPencil(true))) return status('Could not switch pencil mode on.', 'err');

    let first = true;
    for (const [i, toggles] of jobs) {
      selectCell(i);
      await sleep(STEP_DELAY);
      for (const d of toggles) {
        const before = first ? readState().raw : null;
        pressDigit(d);
        if (first) {
          first = false;
          const now = await waitForChange(before);
          if (!now) { await setPencil(wasOn); return status('The game did not respond — nothing changed.', 'err'); }
          if (now.grid[i] !== 0) { // landed as a digit, not a note: undo and stop
            pressControl(undoBtn());
            await setPencil(wasOn);
            return status('Pencil mode check failed — input undone, stopped.', 'err');
          }
        }
        await sleep(STEP_DELAY);
      }
    }
    await setPencil(wasOn);
    await sleep(250);

    const after = readState();
    const c2 = candidates(after.grid);
    let off = 0;
    for (let i = 0; i < 81; i++) {
      if (after.grid[i]) continue;
      if (c2[i].size !== after.notes[i].size || [...c2[i]].some((d) => !after.notes[i].has(d))) off++;
    }
    status(off ? `Updated ${jobs.length} cells, ${off} still differ — click again.` : `Candidates filled in ${jobs.length} cells.`, off ? 'warn' : 'ok');
  }

  async function fillSingles() {
    const st = readState();
    if (st.error) return status(st.error, 'err');
    if (st.mistake.some(Boolean)) return status('There is a wrong digit on the board — fix it first.', 'err');
    const { singles } = analyse(st);
    if (!singles.length) return status('No single-candidate cells right now.', 'warn');

    const wasOn = pencilOn();
    if (!(await setPencil(false))) return status('Could not switch pencil mode off.', 'err');

    let first = true;
    for (const { i, d } of singles) {
      selectCell(i);
      await sleep(STEP_DELAY);
      const before = first ? readState().raw : null;
      pressDigit(d);
      if (first) {
        first = false;
        const now = await waitForChange(before);
        if (!now || now.grid[i] !== d) { await setPencil(wasOn); return status('The game did not accept the input — stopped.', 'err'); }
      }
      await sleep(STEP_DELAY);
    }
    await setPencil(wasOn);
    await sleep(250);

    const after = readState();
    const placed = singles.filter(({ i, d }) => after.grid[i] === d).length;
    const next = analyse(after).singles.length;
    status(`Filled ${placed} cell${placed === 1 ? '' : 's'}.` + (next ? ` ${next} new single${next === 1 ? '' : 's'} — click again.` : ''), 'ok');
  }

  // ---------------------------------------------------------------- display
  // Philosophy: every category is always computed. The panel says whether help
  // exists, of which kind and where; the grid only gets faint markers. Hovering
  // an entry (or a category title) in the panel shows that hint in full.
  // Green is reserved for cells with a single option.
  // Categories start hidden on every page load; only the counts are shown.
  const opts = { show: { single: false, subsets: false, pointing: false }, collapsed: false };
  try {
    const o = JSON.parse(localStorage.getItem('sdkh_opts') || '{}');
    opts.collapsed = !!o.collapsed;
  } catch (e) { /* ignore */ }
  const saveOpts = () => { try { localStorage.setItem('sdkh_opts', JSON.stringify(opts)); } catch (e) { /* ignore */ } };

  const PALETTE = ['#2f6fdc', '#8e44ad', '#e07b1f', '#5c6bc0', '#8d6e63', '#c9a227']; // no green (singles) and no red (erase)
  const CATS = [
    { id: 'single', label: 'Single option', key: 'H' },
    { id: 'subsets', label: 'Pairs & triples', key: 'P' },
    { id: 'pointing', label: 'Pointing', key: 'L' },
  ];
  let focus = null; // hover: { cat } or { cat, k }
  let pin = null;   // "ONE single": { i, d } kept on the grid until that cell is filled
  let gridHover = null; // cell index of a green single under the mouse on the board
  let pinTurn = 0;  // which single the next click picks

  const overlay = document.createElement('div');
  overlay.className = 'sdkh-overlay';
  const cells = Array.from({ length: 81 }, () => overlay.appendChild(document.createElement('div')));
  document.body.appendChild(overlay);

  // Centres of sudoku.com's pencil-note slots, measured on its board (fraction of a cell).
  const NOTE_X = [0.218, 0.505, 0.792], NOTE_Y = [0.228, 0.516, 0.802], SLOT = 0.3;
  const notePos = (m, d) => {
    m.style.left = (NOTE_X[(d - 1) % 3] - SLOT / 2) * 100 + '%';
    m.style.top = (NOTE_Y[Math.floor((d - 1) / 3)] - SLOT / 2) * 100 + '%';
  };
  function mark(cell, cls, d, color) {
    if (cell.querySelector(`.${cls}[data-d="${d}"]`)) return;
    const m = document.createElement('i');
    m.className = cls;
    m.dataset.d = d;
    m.textContent = d;
    notePos(m, d);
    if (color) m.style.setProperty('--c', color);
    cell.appendChild(m);
  }

  // Which cells are hidden behind something else (a site pop-up, a menu, the
  // game-over screen, this panel…)? A cell counts as visible only when the
  // top-most element at its centre is the game board itself.
  function coverMap(cv, r) {
    const game = cv.closest('#game') || cv.parentElement;
    const g = boardGeometry(cv), out = new Array(81);
    const onBoard = (x, y) => {
      const el = (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) ? document.elementFromPoint(x, y) : null;
      return !!(el && (el === cv || el.contains(cv) || game.contains(el)));
    };
    // centre + 4 points near the corners: a partly covered cell counts as covered
    const pts = [[0.5, 0.5], [0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]];
    for (let i = 0; i < 81; i++) {
      const b = cellBox(i, r, g);
      out[i] = !pts.every(([fx, fy]) => onBoard(b.x + fx * b.w, b.y + fy * b.h));
    }
    return out;
  }

  let lastSig = '';
  let last = null; // last analysis, for the list
  function render(force) {
    const cv = canvas();
    const st = cv ? readState() : { error: 'no board' };
    const r = cv ? cv.getBoundingClientRect() : null;
    const covered = r ? coverMap(cv, r) : null;
    const sig = [st.raw || st.error, r ? [r.left, r.top, r.width, scrollX, scrollY].join() : '',
      JSON.stringify(opts.show), JSON.stringify(focus), JSON.stringify(pin), gridHover, covered ? covered.map(Number).join('') : ''].join('|');
    if (!force && sig === lastSig) return;
    lastSig = sig;

    if (st.error) {
      overlay.style.display = 'none';
      last = null;
      renderPanel(null, st.error);
      return;
    }
    const a = analyse(st);
    const groups = { subsets: a.subsets, pointing: a.pointing };
    // stable colors: pairs/triples first, then pointing
    a.subsets.forEach((g, k) => { g.color = PALETTE[k % PALETTE.length]; });
    a.pointing.forEach((g, k) => { g.color = PALETTE[(a.subsets.length + k) % PALETTE.length]; });
    last = { singles: a.singles, dead: a.dead, groups };
    if (focus && focus.k != null) {
      const n = focus.cat === 'single' ? a.singles.length : groups[focus.cat].length;
      if (focus.k >= n) focus = null;
    }
    // the pinned single, if still open
    let pinK = -1;
    if (pin) {
      pinK = a.singles.findIndex((sg) => sg.i === pin.i && sg.d === pin.d);
      if (pinK < 0) {
        const done = st.grid[pin.i] === pin.d;
        pin = null;
        status(done ? 'Done. Click “ONE single” for the next one.' : 'That single no longer applies.', done ? 'ok' : 'warn');
      }
    }
    // a green single hovered on the grid: show it with its reasoning, plus a short explanation
    let hoverK = -1;
    if (gridHover != null && !focus) {
      hoverK = a.singles.findIndex((sg) => sg.i === gridHover && singleShown(sg.i));
      if (hoverK < 0 || (covered && covered[gridHover])) { hoverK = -1; gridHover = null; }
    }
    const F = focus || (hoverK >= 0 ? { cat: 'single', k: hoverK } : null) || (pinK >= 0 ? { cat: 'single', k: pinK } : null);
    renderPanel(last, null);
    renderPin(pinK >= 0 ? a.singles[pinK] : null);

    cells.forEach((el) => { el.className = ''; el.removeAttribute('style'); el.textContent = ''; });
    if (!r) { overlay.style.display = 'none'; return; }
    Object.assign(overlay.style, {
      display: 'block',
      left: r.left + scrollX + 'px', top: r.top + scrollY + 'px',
      width: r.width + 'px', height: r.height + 'px',
    });
    {
      const g = boardGeometry(cv);
      cells.forEach((el, i) => {
        const [x0, x1] = g.cols[i % 9], [y0, y1] = g.rows[Math.floor(i / 9)];
        el.style.left = x0 * 100 + '%'; el.style.width = (x1 - x0) * 100 + '%';
        el.style.top = y0 * 100 + '%'; el.style.height = (y1 - y0) * 100 + '%';
      });
    }

    const visible = (cat, k) => {
      if (F) return F.cat === cat && (F.k == null || F.k === k);
      return opts.show[cat];
    };
    const strong = (cat, k) => !!(F && F.cat === cat && (F.k === k || F.k == null));

    // Hovering one hint also shows, in full, the earlier hints it relies on.
    const depSet = new Set();
    if (F && F.k != null) {
      const item = F.cat === 'single' ? a.singles[F.k] : groups[F.cat][F.k];
      const stack = [...((item && item.deps) || [])];
      while (stack.length) {
        const h = stack.pop();
        if (depSet.has(h)) continue;
        depSet.add(h);
        stack.push(...a.hints[h].deps);
      }
    }

    const drawGroup = (g, mode) => {  // mode: 'soft' | 'dep' | 'strong'
      for (const i of g.cells) {
        const c = cells[i];
        const prev = c.style.boxShadow ? c.style.boxShadow + ', ' : '';
        const depth = prev ? prev.split('inset').length - 1 : 0; // stacked groups: nested thin lines
        const w = mode === 'strong' ? 3 : mode === 'dep' ? 2 : 1.5;
        c.style.boxShadow = prev + `inset 0 0 0 ${w + depth * 2.5}px ${g.color}${mode === 'soft' ? '8c' : ''}`;
        if (mode !== 'soft') g.digits.forEach((d) => mark(c, 'sdkh-key', d, g.color));
        if (mode === 'strong') c.style.background = g.color + '22';
      }
      for (const [j, ds] of g.elims) {
        ds.forEach((d) => {
          if (mode !== 'soft') mark(cells[j], 'sdkh-elim', d);
          else if (st.notes[j].has(d)) mark(cells[j], 'sdkh-elim-soft', d); // faint: only over a real note
        });
      }
    };

    for (const h of depSet) drawGroup(a.hints[h], 'dep');
    for (const cat of ['subsets', 'pointing']) {
      groups[cat].forEach((g, k) => {
        if (!visible(cat, k) || depSet.has(a.hints.indexOf(g))) return;
        drawGroup(g, strong(cat, k) ? 'strong' : 'soft');
      });
    }

    // single options: the only green on the board
    a.singles.forEach((sg, k) => {
      if (!visible('single', k)) return;
      const c = cells[sg.i];
      c.classList.add('sdkh-single');
      if (strong('single', k)) {
        c.classList.add('sdkh-strong');
        if (F.k != null && sg.kind === 'hidden') {   // show the row/column/box it is alone in
          const u = UNITS.find((x) => x.name === sg.unit);
          u.cells.forEach((j) => { if (j !== sg.i) cells[j].classList.add('sdkh-unit'); });
        }
      }
      mark(c, 'sdkh-one', sg.d);   // at the digit's own note position, like a pencil note
    });
    // hovering one single (on the grid or in the list): draw why it is a single
    clearExplain();
    if (F && F.cat === 'single' && F.k != null && (focus || hoverK >= 0) && a.singles[F.k]) {
      drawExplain(a.singles[F.k], st, a, boardGeometry(cv));
    }
    if (!F) {
      for (const i of a.dead) {
        cells[i].classList.add('sdkh-dead');
        cells[i].insertAdjacentHTML('beforeend', '<span class="sdkh-pill">!</span>');
      }
    }

    // nothing is drawn over parts of the grid that something else covers
    covered.forEach((hid, i) => { if (hid) cells[i].style.visibility = 'hidden'; });
    if (covered.some(Boolean)) clearExplain();
    if (covered.every(Boolean)) overlay.style.display = 'none';
  }

  // ---------------------------------------------------------------- "why is it a single?" (drawn on the grid)
  const unitOf = (name) => UNITS.find((u) => u.name === name);
  const unitsOfCell = (i) => [UNITS[Math.floor(i / 9)], UNITS[9 + (i % 9)], UNITS[18 + Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3)]];
  const hintLabel = (g) => `${KIND_LABEL[g.kind]} ${g.digits.join('·')} (${g.units.join(' + ')})`;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  // Why digit d cannot go in cell i: a placed digit in its row/column/box,
  // an earlier hint that erased it, or the player's own notes.
  function whyNot(i, d, st, a, skipUnit) {
    for (const u of unitsOfCell(i)) {
      if (u.name !== skipUnit && u.cells.some((j) => st.grid[j] === d)) return { key: u.name, text: `${u.name} has ${d}` };
    }
    const h = a.removedBy.get(i + ':' + d);
    if (h != null) return { key: 'h' + h, text: `erased by ${hintLabel(a.hints[h])}` };
    if (a.usesNotes && !st.notes[i].has(d)) return { key: 'notes', text: 'not in your notes' };
    return { key: '?', text: 'excluded' };
  }

  // Rays, rings and crossed-out digits that show on the board why a single is a single.
  const RAY = { row: '#2f7be0', column: '#e2871b', box: '#9b4fc4' };
  const NS = 'http://www.w3.org/2000/svg';
  const rays = document.createElementNS(NS, 'svg');
  rays.setAttribute('class', 'sdkh-rays');
  rays.setAttribute('viewBox', '0 0 1000 1000');
  rays.setAttribute('preserveAspectRatio', 'none');
  overlay.insertBefore(rays, overlay.firstChild);   // under the cells' marks
  const chip = document.createElement('div');
  chip.className = 'sdkh-chip';
  overlay.appendChild(chip);
  function clearExplain() { rays.textContent = ''; chip.hidden = true; }

  function drawExplain(sg, st, a, g) {
    clearExplain();
    const center = (i) => {
      const [x0, x1] = g.cols[i % 9], [y0, y1] = g.rows[Math.floor(i / 9)];
      return [(x0 + x1) * 500, (y0 + y1) * 500];
    };
    const slot = (i, d) => {   // where digit d's pencil note sits in cell i
      const [x0, x1] = g.cols[i % 9], [y0, y1] = g.rows[Math.floor(i / 9)];
      return [(x0 + NOTE_X[(d - 1) % 3] * (x1 - x0)) * 1000, (y0 + NOTE_Y[Math.floor((d - 1) / 3)] * (y1 - y0)) * 1000];
    };
    const blockerIn = (unitName, d) => unitOf(unitName).cells.find((j) => st.grid[j] === d);
    const ringed = new Set();
    const ray = (from, to, d, color) => {
      const [x1, y1] = center(from), [x2, y2] = slot(to, d);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const a0 = 44, a1 = 17;   // start outside the blocker's ring, end at the crossed-out digit
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', x1 + ux * a0); line.setAttribute('y1', y1 + uy * a0);
      line.setAttribute('x2', x2 - ux * a1); line.setAttribute('y2', y2 - uy * a1);
      line.setAttribute('stroke', color);
      rays.appendChild(line);
      if (!ringed.has(from)) {   // ring the placed digit that blocks
        ringed.add(from);
        const r = document.createElement('i');
        r.className = 'sdkh-ring';
        r.style.setProperty('--c', color);
        cells[from].appendChild(r);
      }
    };
    // one reason, drawn: a ray from the blocking digit, or the red ring of an erasure
    const show = (cell, d, skipUnit) => {
      const w = whyNot(cell, d, st, a, skipUnit);
      if (/^(row|column|box) /.test(w.key)) {
        const color = RAY[w.key.split(' ')[0]];
        ray(blockerIn(w.key, d), cell, d, color);
        mark(cells[cell], 'sdkh-x', d, color);
      } else if (w.key.startsWith('h')) {
        mark(cells[cell], 'sdkh-elim', d);          // the hint itself is drawn as a dependency
      } else {
        mark(cells[cell], 'sdkh-x', d, '#8a93a8');  // not in the player's notes
      }
    };

    if (sg.kind === 'naked') {
      for (const u of unitsOfCell(sg.i)) u.cells.forEach((j) => { if (j !== sg.i) cells[j].classList.add('sdkh-unit'); });
      for (let d = 1; d <= 9; d++) if (d !== sg.d) show(sg.i, d);
      chip.textContent = `only ${sg.d} fits here`;
    } else {
      const u = unitOf(sg.unit);
      for (const j of u.cells) if (j !== sg.i && !st.grid[j]) show(j, sg.d, u.name);
      chip.textContent = `only place for ${sg.d} in ${sg.unit}`;
    }
    // label just outside the board, above the single's column, so it never hides the grid
    const [x0, x1] = g.cols[sg.i % 9], c = sg.i % 9;
    chip.hidden = false;
    chip.style.left = (c === 0 ? x0 : c === 8 ? x1 : (x0 + x1) / 2) * 100 + '%';
    chip.dataset.edge = c === 0 ? 'left' : c === 8 ? 'right' : '';
  }

  // Is this cell's green single drawn on the grid right now?
  const singleShown = (i) => opts.show.single || (pin && pin.i === i);

  // Track the mouse over the board (the overlay itself lets clicks through).
  function cellAt(x, y) {
    const cv = canvas();
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
    const g = boardGeometry(cv), fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
    const c = g.cols.findIndex(([a0, a1]) => fx >= a0 && fx < a1), rr = g.rows.findIndex(([a0, a1]) => fy >= a0 && fy < a1);
    return c < 0 || rr < 0 ? null : rr * 9 + c;
  }
  let moveQueued = false, lastXY = null;
  document.addEventListener('mousemove', (e) => {
    lastXY = [e.clientX, e.clientY];
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      if (busy || !last) return;
      const i = cellAt(lastXY[0], lastXY[1]);
      const hit = i != null && singleShown(i) && last.singles.some((sg) => sg.i === i) && cells[i].style.visibility !== 'hidden'
        && !(e.target && e.target.closest && e.target.closest('.sdkh-panel')) ? i : null;
      if (hit !== gridHover) { gridHover = hit; render(true); }
    });
  }, { passive: true, capture: true });
  document.addEventListener('mouseleave', () => { if (gridHover != null) { gridHover = null; render(true); } });

  // ---------------------------------------------------------------- panel
  const panel = document.createElement('div');
  panel.className = 'sdkh-panel';
  panel.innerHTML = `
    <div class="sdkh-head" title="Drag the panel to move it · double-click here to put it back top-right"><span>⠿ Sudoku Hint Panel</span><button class="sdkh-min" title="Collapse / expand">–</button></div>
    <div class="sdkh-body">
      <div class="sdkh-fair" hidden>
        <b>Learn at your own level</b>
        <p>Open only as much as you need: a count, one technique, or a single hint with its reasoning — so next time you spot it yourself. Regular games also count for sudoku.com tournaments and leaderboards: play those on your own.</p>
        <button class="sdkh-fair-ok">Got it</button>
      </div>
      <div class="sdkh-actions">
        <button data-act="cand" title="Alt+Shift+C — set every empty cell's notes to its possible digits">✎ Candidates</button>
        <button data-act="fill" title="Alt+Shift+F — type the digit into every single-option cell">⚡ Fill singles</button>
        <button data-act="one" class="sdkh-one-btn" title="Alt+Shift+O — show ONE single option on the grid (the easiest first); click again for another">☝ ONE single</button>
      </div>
      <div class="sdkh-pin" hidden></div>
      <div class="sdkh-summary"></div>
      <div class="sdkh-cats">${CATS.map((c) => `
        <div class="sdkh-cat" data-cat="${c.id}">
          <div class="sdkh-cat-head" title="Click: show / hide on the grid (Alt+Shift+${c.key}) · hover: show only this category">
            <button class="sdkh-eye" data-cat="${c.id}"></button><span>${c.label}</span><b class="sdkh-count"></b>
          </div>
          <div class="sdkh-items"></div>
        </div>`).join('')}
      </div>
      <div class="sdkh-status"></div>
    </div>`;
  document.body.appendChild(panel);

  const summaryEl = panel.querySelector('.sdkh-summary');
  const pinEl = panel.querySelector('.sdkh-pin');
  // one-time fair-play notice
  const fairEl = panel.querySelector('.sdkh-fair');
  try { fairEl.hidden = localStorage.getItem('sdkh_fairplay_ok') === '1'; } catch (e) { fairEl.hidden = false; }
  const statusEl = panel.querySelector('.sdkh-status');
  const headEl = panel.querySelector('.sdkh-head');
  const minBtn = panel.querySelector('.sdkh-min');
  const catEls = Object.fromEntries(CATS.map((c) => [c.id, panel.querySelector(`.sdkh-cat[data-cat="${c.id}"]`)]));
  let statusTimer;

  function status(msg, kind = '') {
    statusEl.textContent = msg;
    statusEl.className = 'sdkh-status ' + (kind ? 'sdkh-' + kind : '');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 6000);
  }

  const KIND_LABEL = { pair: 'Pair', triple: 'Triple', pointing: 'Pointing' };
  // step 1 = visible on the board as it is; step n = needs the erasures of earlier hints
  const stepTag = (n) => (n > 1 ? `<small class="sdkh-step" title="Relies on earlier hints — hover to see them">step ${n}</small>` : '<small></small>');
  const lastItems = {};
  function renderPanel(res, error) {
    if (!res) {
      summaryEl.textContent = error || '';
      summaryEl.className = 'sdkh-summary sdkh-err';
      for (const c of CATS) { catEls[c.id].querySelector('.sdkh-count').textContent = '–'; setItems(c.id, ''); }
      return;
    }
    const counts = { single: res.singles.length, subsets: res.groups.subsets.length, pointing: res.groups.pointing.length };
    const total = counts.single + counts.subsets + counts.pointing;
    summaryEl.className = 'sdkh-summary' + (res.dead.length ? ' sdkh-err' : total ? ' sdkh-yes' : '');
    summaryEl.textContent = res.dead.length ? `⚠ ${res.dead.length} cell${res.dead.length > 1 ? 's have' : ' has'} no possible digit — check for a mistake.`
      : total ? 'Help available:' : 'No help found with these techniques.';
    for (const c of CATS) {
      const el = catEls[c.id];
      el.querySelector('.sdkh-count').textContent = String(counts[c.id]);
      el.classList.toggle('sdkh-has', counts[c.id] > 0);
      el.classList.toggle('sdkh-off', !opts.show[c.id]);
      let html = '';
      if (opts.show[c.id]) {
        if (c.id === 'single') {
          html = res.singles.map((sg, k) => {
            const why = sg.kind === 'naked' ? 'only digit here' : `only ${sg.d} in ${sg.unit}`;
            return `<div class="sdkh-item" data-cat="single" data-k="${k}" title="${cellName(sg.i)}: ${why}${sg.step > 1 ? ' — once the earlier hints are applied (hover to see them)' : ''}">
              <i class="sdkh-dot sdkh-green"></i><b>${cellName(sg.i)} → ${sg.d}</b><span>${why}</span>${stepTag(sg.step)}</div>`;
          }).join('');
        } else {
          html = res.groups[c.id].map((g, k) => {
            const n = [...g.elims.values()].reduce((s2, ds) => s2 + ds.length, 0);
            return `<div class="sdkh-item" data-cat="${c.id}" data-k="${k}" title="${g.cells.map(cellName).join(', ')} — erase ${g.digits.join('/')} from ${[...g.elims.keys()].map(cellName).join(', ')}">
              <i class="sdkh-dot" style="background:${g.color}"></i><b>${KIND_LABEL[g.kind]} ${g.digits.join('·')}</b>
              <span>${g.units.join(' + ')}</span>${g.step > 1 ? stepTag(g.step) : `<em>−${n}</em>`}</div>`;
          }).join('');
        }
      }
      setItems(c.id, html);
    }
  }
  function renderPin(sg) {
    if (!sg) { pinEl.hidden = true; pinEl.innerHTML = ''; return; }
    const why = sg.kind === 'naked' ? 'only digit here' : `only ${sg.d} in ${sg.unit}`;
    pinEl.hidden = false;
    pinEl.innerHTML = `<i class="sdkh-dot sdkh-green"></i><b>${cellName(sg.i)} → ${sg.d}</b><span>${why}${sg.step > 1 ? ` · step ${sg.step}` : ''}</span><button class="sdkh-unpin" title="Hide">✕</button>`;
  }

  // Pick one single: easiest first (step 1 before chained ones, "only digit
  // here" before "only place"), then the next one on each click.
  function pickOne() {
    const st = readState();
    if (st.error) return status(st.error, 'err');
    const list = analyse(st).singles.slice()
      .sort((p, q) => p.step - q.step || (p.kind === q.kind ? 0 : p.kind === 'naked' ? -1 : 1) || p.i - q.i);
    if (!list.length) { pin = null; render(true); return status('No single option right now — try the pairs / pointing hints.', 'warn'); }
    let k = pinTurn % list.length;
    if (pin && list[k].i === pin.i && list.length > 1) k = (k + 1) % list.length;
    pin = { i: list[k].i, d: list[k].d };
    pinTurn = k + 1;
    status('');
    render(true);
  }

  function setItems(cat, html) {
    if (lastItems[cat] === html) return;
    lastItems[cat] = html;
    catEls[cat].querySelector('.sdkh-items').innerHTML = html;
  }

  function syncUi() {
    for (const c of CATS) catEls[c.id].classList.toggle('sdkh-off', !opts.show[c.id]);
    panel.classList.toggle('sdkh-collapsed', !!opts.collapsed);
    minBtn.textContent = opts.collapsed ? '+' : '–';
  }

  const toggleCat = (cat) => {
    opts.show[cat] = !opts.show[cat];
    focus = null;
    saveOpts(); syncUi(); render(true);
  };

  // Hover: an entry shows only that hint; a category title shows only that category.
  const cats = panel.querySelector('.sdkh-cats');
  cats.addEventListener('mouseover', (e) => {
    const it = e.target.closest('.sdkh-item');
    const hd = e.target.closest('.sdkh-cat-head');
    let f = null;
    if (it) f = { cat: it.dataset.cat, k: Number(it.dataset.k) };
    else if (hd) f = { cat: hd.parentElement.dataset.cat };
    if (JSON.stringify(f) !== JSON.stringify(focus)) { focus = f; render(true); }
  });
  cats.addEventListener('mouseleave', () => { focus = null; render(true); });

  panel.addEventListener('click', (e) => {
    if (e.target.closest('.sdkh-cat-head')) { toggleCat(e.target.closest('.sdkh-cat').dataset.cat); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b === minBtn) { opts.collapsed = !opts.collapsed; saveOpts(); syncUi(); clampPanel(); return; }
    if (b.classList.contains('sdkh-unpin')) { pin = null; render(true); return; }
    if (b.classList.contains('sdkh-fair-ok')) {
      fairEl.hidden = true;
      try { localStorage.setItem('sdkh_fairplay_ok', '1'); } catch (err) { /* ignore */ }
      clampPanel();
      return;
    }
    if (b.dataset.act === 'one') { pickOne(); return; }
    if (b.dataset.act === 'cand') run(fillCandidates);
    else if (b.dataset.act === 'fill') run(fillSingles);
  });

  // ---------------------------------------------------------------- dragging
  function loadPos() { try { return JSON.parse(localStorage.getItem('sdkh_pos') || 'null'); } catch (e) { return null; } }
  function savePos() {
    try {
      const r = panel.getBoundingClientRect();
      localStorage.setItem('sdkh_pos', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
    } catch (e) { /* ignore */ }
  }
  function placePanel(x, y) {
    const maxX = Math.max(0, innerWidth - panel.offsetWidth);
    const maxY = Math.max(0, innerHeight - panel.offsetHeight);
    Object.assign(panel.style, {
      left: Math.min(Math.max(0, x), maxX) + 'px',
      top: Math.min(Math.max(0, y), maxY) + 'px',
      right: 'auto', bottom: 'auto',
    });
  }
  function clampPanel() {
    if (!panel.style.left) return; // still at its default corner
    placePanel(parseFloat(panel.style.left), parseFloat(panel.style.top));
  }

  // Drag the panel from anywhere except its buttons. A few pixels of
  // movement are needed before it moves, so plain clicks stay clicks.
  panel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, select, input, a, .sdkh-cat-head, .sdkh-item')) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const dx = sx - r.left, dy = sy - r.top;
    let dragging = false;
    const move = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
        dragging = true;
        panel.classList.add('sdkh-dragging');
      }
      ev.preventDefault();
      placePanel(ev.clientX - dx, ev.clientY - dy);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (dragging) { panel.classList.remove('sdkh-dragging'); savePos(); }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    e.preventDefault(); // no text selection while dragging
  });
  headEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
    try { localStorage.removeItem('sdkh_pos'); } catch (err) { /* ignore */ }
  });

  // Keep the game from treating clicks on the panel as board clicks.
  for (const t of ['mousedown', 'pointerdown', 'keydown']) panel.addEventListener(t, (e) => e.stopPropagation());

  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted || !e.altKey || !e.shiftKey) return;
    const map = { KeyC: () => run(fillCandidates), KeyF: () => run(fillSingles), KeyO: pickOne,
      KeyH: () => toggleCat('single'), KeyP: () => toggleCat('subsets'), KeyL: () => toggleCat('pointing') };
    if (map[e.code]) { e.preventDefault(); e.stopPropagation(); map[e.code](); }
  }, true);

  syncUi();
  const saved = loadPos();
  if (saved) placePanel(saved.x, saved.y);
  render(true);

  // Live updates: page-bridge.js signals every time the game saves a move;
  // the 250 ms poll is only a fallback.
  document.addEventListener('sdkh-game-saved', () => { if (!busy) render(false); });
  setInterval(() => { if (!busy) render(false); }, 250);
  window.addEventListener('scroll', () => render(false), { passive: true });
  window.addEventListener('resize', () => { clampPanel(); render(false); });
})();
