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

  // ---------------------------------------------------------------- engine (engine.js)
  // sudoku.com plays the classic 9×9 grid.
  const ENGINE = createSudokuEngine(3, 3);
  const { CAT_OF, FISH, GRADE_CUTS, GRADE_LEVELS, GRADE_STEPS, GROUP_CATS, MAIN_TIERS, MAX_CHAIN, PEERS, ROWS, COLS, TECH_NAMES, TIERS, UNITS, addElim, analyse, analyseFresh, anySingle, boxOf, candidates, cellName, combos, effectiveCands, findChains, findColoring, findFish, findForcing, findHidden, findPointing, findQuads, findRectangles, findSubsets, findWings, gradeGrid, has, notesCheck, notesComplete, range9, sees, solveGrid, solvePath, tryDigit } = ENGINE;
  // what each hint says (explain.js)
  const { ASSIST_RANK, CHAIN_NAMES, FISH_NAME, KIND_LABEL, WING_NAME, alreadyNoted, assistList, assistUnit, assistWhat, cap, conflictText, hintDigitsIn, hintLabel, hintLook, hintWhat, hintWhy, shadeOf, unitOf, unitsOfCell, whyNot } = createExplainer(ENGINE);

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
    // the site says which puzzle is on screen: trust it over save timing
    // (switching difficulty can save the previous game after the new one loads)
    if (page.id) {
      if (saved && String(saved.id) === page.id) return null;
      if (String(lv.id) === page.id) return lv;
    }
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

  // optimized: the candidates after every erasure that pairs, triples and
  // pointing allow, chained until nothing changes (what the hints would erase).
  async function fillCandidates(optimized) {
    const st = readState();
    if (st.error) return status(st.error, 'err');
    let cand = candidates(st.grid);
    if (optimized) {
      cand = analyse(st, MAIN_TIERS).reduced;
      const sol = solveGrid(st.grid);   // safety net: never erase a cell's real digit
      if (sol) for (let i = 0; i < 81; i++) if (cand[i] && !cand[i].has(sol[i])) cand[i] = candidates(st.grid)[i];
    }
    const jobs = [];
    for (let i = 0; i < 81; i++) {
      if (st.grid[i]) continue;
      const toggles = [];
      for (let d = 1; d <= 9; d++) if (cand[i].has(d) !== st.notes[i].has(d)) toggles.push(d);
      if (toggles.length) jobs.push([i, toggles]);
    }
    if (!jobs.length) return status(optimized ? 'Notes are already optimized.' : 'Candidates are already complete.', 'ok');

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
    const c2 = cand;
    let off = 0;
    for (let i = 0; i < 81; i++) {
      if (after.grid[i]) continue;
      if (c2[i].size !== after.notes[i].size || [...c2[i]].some((d) => !after.notes[i].has(d))) off++;
    }
    status(off ? `Updated ${jobs.length} cells, ${off} still differ — click again.`
      : optimized ? `Optimized notes in ${jobs.length} cells.` : `Candidates filled in ${jobs.length} cells.`, off ? 'warn' : 'ok');
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

  // Finish grid: type the rest of the solution, one digit at a time, in the
  // order a person could find it — simplest techniques first (asks for a second click).
  async function finishGrid() {
    const st = readState();
    if (st.error) return status(st.error, 'err');
    if (pageInfo().type === 'killer') return status('Finish grid isn’t available for Killer puzzles (cages aren’t used).', 'warn');
    if (st.mistake.some(Boolean)) return status('There is a wrong digit on the board — fix it first.', 'err');
    if (!st.grid.includes(0)) return status('The grid is already complete.', 'ok');
    const path = solvePath(st.grid);
    if (!path) return status('No solution fits the digits on the board — check for a mistake.', 'err');
    const todo = path.steps;

    const wasOn = pencilOn();
    if (!(await setPencil(false))) return status('Could not switch pencil mode off.', 'err');
    let first = true, hardest = 0;
    for (const { i, d, tech } of todo) {
      status(`Finishing: ${TECH_NAMES[tech]}…`, 'ok');
      selectCell(i);
      await sleep(STEP_DELAY);
      const before = first ? readState().raw : null;
      pressDigit(d);
      if (first) {
        first = false;
        const now = await waitForChange(before);
        if (!now || now.grid[i] !== d) { await setPencil(wasOn); return status('The game did not accept the input — stopped.', 'err'); }
      }
      hardest = Math.max(hardest, tech);
      await sleep(STEP_DELAY);
    }
    await setPencil(wasOn);
    status(`Finished: ${todo.length} digit${todo.length === 1 ? '' : 's'}, simplest first — hardest step: ${TECH_NAMES[hardest]}.`
      + (path.unreached ? ` ${path.unreached} of them needed more than the panel's techniques and came from the solution.` : ''), 'ok');
  }
  let finishArmed = 0;   // first click arms the button, a second click within 4 s runs it
  function finishClick(btn) {
    if (Date.now() - finishArmed < 4000) { finishArmed = 0; btn.textContent = '🏁 Finish grid'; btn.classList.remove('sdkh-armed'); run(finishGrid); return; }
    finishArmed = Date.now();
    btn.textContent = 'Click to confirm';
    btn.classList.add('sdkh-armed');
    setTimeout(() => { if (Date.now() - finishArmed >= 3900) { btn.textContent = '🏁 Finish grid'; btn.classList.remove('sdkh-armed'); } }, 4000);
  }

  // ---------------------------------------------------------------- display
  // Philosophy: every category is always computed. The panel says whether help
  // exists, of which kind and where; the grid only gets faint markers. Hovering
  // an entry (or a category title) in the panel shows that hint in full.
  // Green is reserved for cells with a single option.
  // Categories start hidden on every page load; only the counts are shown.
  const opts = { show: {}, collapsed: false, expert: false };
  try {
    const o = JSON.parse(localStorage.getItem('sdkh_opts') || '{}');
    opts.collapsed = !!o.collapsed;
    opts.assist = !!o.assist;
    opts.expert = !!o.expert;
    opts.advanced = !!o.advanced;
  } catch (e) { /* ignore */ }
  const saveOpts = () => { try { localStorage.setItem('sdkh_opts', JSON.stringify(opts)); } catch (e) { /* ignore */ } };

  const CAT_HTML = (c) => `
        <div class="sdkh-cat" data-cat="${c.id}">
          <div class="sdkh-cat-head" title="Click: show / hide on the grid${c.key ? ` (Alt+Shift+${c.key})` : ''} · hover: show only this category">
            <button class="sdkh-eye" data-cat="${c.id}"></button><span>${c.label}</span><b class="sdkh-count"></b>
          </div>
          <div class="sdkh-items"></div>
        </div>`;
  const PALETTE = ['#1565c0', '#8e24aa', '#ef6c00', '#00838f', '#6d4c41', '#37474f']; // no green (singles) and no red (erase)
  // From the simplest help to the most advanced; expert ones sit in a folded group.
  const CATS = [
    { id: 'single', label: 'Single option', key: 'H' },
    { id: 'pointing', label: 'Pointing', key: 'L' },
    { id: 'subsets', label: 'Pairs & triples', key: 'P' },
    { id: 'coloring', label: 'Chains', key: 'K' },
    { id: 'quads', label: 'Quads', expert: true },
    { id: 'fish', label: 'X-wing & fish', expert: true },
    { id: 'wings', label: 'Wings', expert: true },
    { id: 'ur', label: 'Unique rectangles', expert: true },
    { id: 'chains', label: 'Long chains', expert: true },
    { id: 'forcing', label: 'Forcing chains', expert: true },
  ];
  CATS.forEach((c) => { opts.show[c.id] = false; });
  let focus = null; // hover: { cat } or { cat, k }
  let pin = null;   // "ONE single": { i, d } kept on the grid until that cell is filled
  // Assist mode: one hint at a time, easiest first, revealed in 3 levels
  // (1 where to look · 2 what · 3 why); moves on once applied, or on Skip.
  const assist = { on: false, key: null, level: 1, skipped: new Set(), shown: 0 };
  let gridHover = null; // { cat, i }: a hint cell under the mouse on the board
  let pinTurn = 0;  // which single the next click picks

  const overlay = document.createElement('div');
  overlay.className = 'sdkh-overlay';
  const cells = Array.from({ length: 81 }, () => overlay.appendChild(document.createElement('div')));
  // links of a chain, drawn under the cells' marks
  const linkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  linkSvg.setAttribute('class', 'sdkh-links');
  linkSvg.setAttribute('viewBox', '0 0 1000 1000');
  linkSvg.setAttribute('preserveAspectRatio', 'none');
  overlay.insertBefore(linkSvg, overlay.firstChild);
  const CHAIN_COLORS = ['#1565c0', '#ef6c00'];   // the two colours of a chain: blue, orange
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
    const paintCache = new Map();
    // does this layer actually show something over the board? (an ad layer
    // left in place after it has gone invisible must not count)
    const paints = (el) => {
      if (paintCache.has(el)) return paintCache.get(el);
      let shows = false, opacity = 1;
      for (let e = el; e && !e.contains(cv) && !shows; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.display === 'none') break;
        opacity *= Number(cs.opacity);
        if (opacity < 0.15) break;
        const bg = cs.backgroundColor.match(/[\d.]+/g);
        const alpha = !bg ? 0 : bg.length > 3 ? Number(bg[3]) : 1;
        shows = alpha > 0.15 || cs.backgroundImage !== 'none' || /^(IMG|VIDEO|IFRAME|CANVAS|SVG|svg)$/.test(e.tagName);
      }
      paintCache.set(el, shows);
      return shows;
    };
    const onBoard = (x, y) => {
      // a point scrolled out of the window isn't covered by anything: the
      // drawing there is simply clipped by the window edge
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      return el === cv || el.contains(cv) || game.contains(el) || !paints(el);
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
  let showBadNotes = false;   // hovering the "notes erased by mistake" line
  function render(force) {
    const cv = canvas();
    const st = cv ? readState() : { error: 'no board' };
    const r = cv ? cv.getBoundingClientRect() : null;
    const covered = r ? coverMap(cv, r) : null;
    const sig = [st.raw || st.error, r ? [r.left, r.top, r.width, scrollX, scrollY].join() : '',
      JSON.stringify(opts.show), JSON.stringify(focus), JSON.stringify(pin), JSON.stringify(gridHover), covered ? covered.map(Number).join('') : ''].join('|');
    if (!force && sig === lastSig) return;
    lastSig = sig;

    updateGrade(cv ? st : null);

    // No game in play (finished, behind a pop-up or an ad, scrolled away, or no
    // board on this page): the panel goes quiet — title bar only, no message,
    // no numbers — until a grid is back on screen.
    const hiddenCells = covered ? covered.filter(Boolean).length : 81;
    const inView = r ? Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / (r.width * r.height || 1) : 0;
    const idle = !r || r.width < 60 || inView < 0.4 || hiddenCells > 40 || (!st.error && st.grid.every(Boolean)) || /^No .* game found/.test(st.error || '');
    panel.classList.toggle('sdkh-idle', idle);
    if (idle) {
      overlay.style.display = 'none';
      clearExplain();
      last = null;
      return;
    }

    if (st.error) {
      overlay.style.display = 'none';
      last = null;
      renderPanel(null, st.error);
      return;
    }
    const a = analyse(st);
    const groups = Object.fromEntries(GROUP_CATS.map((c) => [c, a[c]]));
    // stable colors: pairs/triples first, then pointing
    let nColor = 0;
    for (const c of GROUP_CATS) a[c].forEach((g) => { g.color = g.colorOf ? CHAIN_COLORS[0] : PALETTE[nColor++ % PALETTE.length]; });
    last = { singles: a.singles, dead: a.dead, badNotes: a.badNotes, groups };
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
    let hoverK = -1, hoverF = null;
    if (gridHover && !focus) {
      if (covered && covered[gridHover.i]) gridHover = null;
      else if (gridHover.cat === 'single') {
        hoverK = a.singles.findIndex((sg) => sg.i === gridHover.i && singleShown(sg.i));
        if (hoverK >= 0) hoverF = { cat: 'single', k: hoverK };
      } else if (opts.show[gridHover.cat]) {
        const k = groups[gridHover.cat].findIndex((g) => g.cells.includes(gridHover.i));
        if (k >= 0) hoverF = { cat: gridHover.cat, k };
      }
      if (!hoverF) gridHover = null;
    }
    const F = focus || hoverF || (pinK >= 0 ? { cat: 'single', k: pinK } : null);
    renderPanel(last, null);
    renderPin(pinK >= 0 ? a.singles[pinK] : null);

    cells.forEach((el) => { el.className = ''; el.removeAttribute('style'); el.textContent = ''; });
    linkSvg.textContent = '';
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

    if (assist.on) { renderAssist(a, st, cv, covered); return; }

    const explaining = !!(F && F.cat === 'single' && F.k != null && (focus || hoverK >= 0) && a.singles[F.k]);
    const visible = (cat, k) => {
      // explaining one single: the other active singles stay on the grid, other hints step back
      if (explaining) return cat === 'single' && (k === F.k || singleShown(a.singles[k].i));
      if (F) return F.cat === cat && (F.k == null || F.k === k);
      return opts.show[cat];
    };
    const strong = (cat, k) => !!(F && F.cat === cat && (F.k === k || F.k == null));

    // A hovered pair / triple / pointing group is drawn with the same simple
    // vocabulary as singles (see drawGroupFocus). Otherwise (e.g. the pinned
    // ONE single) the earlier hints it relies on are shown in full.
    const groupFocus = F && F.k != null && F.cat !== 'single' ? groups[F.cat][F.k] : null;
    const depSet = new Set();
    if (F && F.k != null && !explaining && !groupFocus) {
      const item = F.cat === 'single' ? a.singles[F.k] : groups[F.cat][F.k];
      const stack = [...((item && item.deps) || [])];
      while (stack.length) {
        const h = stack.pop();
        if (depSet.has(h)) continue;
        depSet.add(h);
        stack.push(...a.hints[h].deps);
      }
    }

    const geo = boardGeometry(cv);
    const drawGroup = (g, mode) => drawHint(g, a, mode, geo, st);   // mode: 'soft' | 'dep' | 'strong'

    for (const h of depSet) drawGroup(a.hints[h], 'dep');
    for (const cat of GROUP_CATS) {
      groups[cat].forEach((g, k) => {
        if (!visible(cat, k) || depSet.has(a.hints.indexOf(g))) return;
        drawGroup(g, strong(cat, k) ? 'strong' : 'soft');
      });
    }
    if (groupFocus) {
      // where it applies: its row / column / box, lightly shaded (a chain shows its links instead)
      const names = shadeOf(groupFocus);
      for (const n of names) {
        const u = unitOf(n);
        if (u) u.cells.forEach((j) => { if (!groupFocus.cells.includes(j)) cells[j].classList.add('sdkh-unit'); });
      }
      // earlier hints it needed: their cells outlined in red, with their digits
      for (const h of groupFocus.deps || []) {
        const hint = a.hints[h];
        for (const i of hint.cells) {
          if (groupFocus.cells.includes(i)) continue;
          cells[i].classList.add('sdkh-hintcell');
          hintDigitsIn(hint, i, a).forEach((d) => mark(cells[i], 'sdkh-hintdigit', d));
        }
      }
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
    if (explaining) drawExplain(a.singles[F.k], st, a, boardGeometry(cv));
    if (showBadNotes) for (const i of a.badNotes) cells[i].classList.add('sdkh-badnote');
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

  // Any hint on the grid: its cells framed (a chain in its two colours), its
  // digits, the notes it erases in red, and in strong modes the links of a
  // chain. A forcing chain shows the cell tried, the singles that follow (grey)
  // and where it breaks (red).
  const STEP_GREY = '#8a93a8';
  function drawHint(g, a, mode, geo, st) {
    const forcing = g.kind === 'forcing';
    g.cells.forEach((i, n) => {
      const c = cells[i];
      const col = g.colorOf ? CHAIN_COLORS[g.colorOf.get(i)] : forcing && n > 0 ? STEP_GREY : g.color;
      if (!forcing || n === 0) {
        const f = document.createElement('b');
        f.className = 'sdkh-frame sdkh-frame-' + mode;
        f.style.setProperty('--c', col);
        f.style.inset = 2 + c.querySelectorAll('.sdkh-frame').length * 4 + 'px';
        c.insertBefore(f, c.firstChild);   // under the digit marks
      }
      if (mode === 'soft' || (forcing && mode === 'dep')) return;
      const erased = g.elims.get(i) || [];
      hintDigitsIn(g, i, a).forEach((d) => { if (!erased.includes(d)) mark(c, 'sdkh-key', d, col); });
    });
    for (const [j, ds] of g.elims) ds.forEach((d) => {
      if (mode !== 'soft') mark(cells[j], 'sdkh-elim', d);
      else if (!st || !st.notes[j] || st.notes[j].has(d)) mark(cells[j], 'sdkh-elim-soft', d); // faint: only over a real note
    });
    if (mode === 'soft') return;
    if (forcing) {
      if (g.conflict != null) cells[g.conflict].classList.add('sdkh-dead');
      if (g.conflictUnit) unitOf(g.conflictUnit).cells.forEach((j) => cells[j].classList.add('sdkh-conflict'));
    }
    for (const [p, q, ld] of g.links || []) {
      const d = ld || g.digits[0];
      const at = (i) => {
        const [x0, x1] = geo.cols[i % 9], [y0, y1] = geo.rows[Math.floor(i / 9)];
        return [(x0 + (x1 - x0) * NOTE_X[(d - 1) % 3]) * 1000, (y0 + (y1 - y0) * NOTE_Y[Math.floor((d - 1) / 3)]) * 1000];
      };
      const [x1, y1] = at(p), [x2, y2] = at(q);
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      linkSvg.appendChild(l);
    }
  }
  // ---------------------------------------------------------------- assist mode
  function placeChip(text, i, g) {
    const [x0, x1] = g.cols[i % 9], c = i % 9;
    chip.textContent = text;
    chip.hidden = false;
    chip.style.left = (c === 0 ? x0 : c === 8 ? x1 : (x0 + x1) / 2) * 100 + '%';
    chip.dataset.edge = c === 0 ? 'left' : c === 8 ? 'right' : '';
  }

  function renderAssist(a, st, cv, covered) {
    const g = boardGeometry(cv);
    const list = assistList(a, st);
    let cur = list.find((x) => x.key === assist.key);
    if (!cur) {
      const was = assist.cur;   // applied by the player (not just gone)?
      const applied = was && (was.cat === 'single' ? st.grid[was.item.i] === was.item.d
        : [...was.item.elims].every(([j, ds]) => st.grid[j] || ds.every((d) => !st.notes[j].has(d))));
      if (assist.key && applied) status(list.length ? '✓ Done — here is the next one.' : '✓ Done.', 'ok');
      let open = list.filter((x) => !assist.skipped.has(x.key));
      if (!open.length && list.length) {
        assist.skipped.clear(); open = list;
        status(list.length === 1 ? 'That is the only hint for now.' : 'Back to the first hint.', 'warn');
      }
      cur = open[0] || null;
      assist.key = cur ? cur.key : null;
      assist.level = 1;
      if (cur) assist.shown++;
    }
    assist.cur = cur;
    renderAssistCard(cur, a);
    clearExplain();
    if (cur) {
      const x = cur.item;
      const u = assistUnit(cur);
      if (assist.level === 1) {
        const look = cur.cat === 'single' ? { cells: u.cells, chip: `look in ${u.name}`, unit: u } : hintLook(x);
        look.cells.forEach((j) => cells[j].classList.add('sdkh-look'));
        placeChip(look.chip, look.unit ? look.unit.cells[4] : look.cells[0], g);
      } else if (cur.cat === 'single') {
        const c = cells[x.i];
        c.classList.add('sdkh-single', 'sdkh-strong');
        mark(c, 'sdkh-one', x.d);
        if (assist.level === 2) {
          u.cells.forEach((j) => { if (j !== x.i) cells[j].classList.add('sdkh-unit'); });
          placeChip(assistWhat(cur), x.i, g);
        } else drawExplain(x, st, a, g);
      } else {
        // the hint: framed, with its digits, links and the notes it erases
        drawHint(x, a, 'strong', g, st);
        if (assist.level === 3) {
          // where it applies, and the earlier hints it needed (red)
          for (const n of shadeOf(x)) {
            const uu = unitOf(n);
            if (uu) uu.cells.forEach((j) => { if (!x.cells.includes(j)) cells[j].classList.add('sdkh-unit'); });
          }
          for (const h of x.deps || []) {
            for (const i of a.hints[h].cells) {
              if (x.cells.includes(i)) continue;
              cells[i].classList.add('sdkh-hintcell');
              hintDigitsIn(a.hints[h], i, a).forEach((d) => mark(cells[i], 'sdkh-hintdigit', d));
            }
          }
        }
        placeChip(assistWhat(cur), x.cells[0], g);
      }
    }
    covered.forEach((hid, i) => { if (hid) cells[i].style.visibility = 'hidden'; });
    if (covered.some(Boolean)) clearExplain();
  }

  // ---------------------------------------------------------------- "why is it a single?" (drawn on the grid)


  // Why a single is a single, drawn with a small visual vocabulary:
  //   green        the single and its digit
  //   blue circle  a placed digit that rules something out
  //   light shade  where to look (the cell's row/column/box, or the one unit)
  //   grey ×       another cell of that unit that can't take the digit
  //   red          only when an earlier hint was needed: what it erased, and its cells outlined with its digits
  const chip = document.createElement('div');
  chip.className = 'sdkh-chip';
  chip.hidden = true;
  overlay.appendChild(chip);
  function clearExplain() { chip.hidden = true; }

  function drawExplain(sg, st, a, g) {
    clearExplain();
    const ringed = new Set(), usedHints = new Set();
    let byNotes = 0;
    const ring = (i) => {
      if (i == null || ringed.has(i)) return;
      ringed.add(i);
      const r = document.createElement('i');
      r.className = 'sdkh-ring';
      cells[i].appendChild(r);
    };
    const cross = (i, cls) => {
      const x = document.createElement('i');
      x.className = cls;
      x.textContent = /notes/.test(cls) ? '✎' : '×';
      cells[i].appendChild(x);
    };
    const blockerIn = (unitName, d) => unitOf(unitName).cells.find((j) => st.grid[j] === d);
    const shade = (u, except) => u.cells.forEach((j) => {
      if (j !== except && !cells[j].classList.contains('sdkh-single')) cells[j].classList.add('sdkh-unit');   // other singles keep their green
    });

    if (sg.kind === 'naked') {
      // the cell's row, column and box hold all the other digits
      unitsOfCell(sg.i).forEach((u) => shade(u, sg.i));
      for (let d = 1; d <= 9; d++) {
        if (d === sg.d) continue;
        const w = whyNot(sg.i, d, st, a);
        if (/^(row|column|box) /.test(w.key)) ring(blockerIn(w.key, d));
        else if (w.key.startsWith('h')) { mark(cells[sg.i], 'sdkh-elim', d); usedHints.add(+w.key.slice(1)); }
        else if (w.key === 'notes') { mark(cells[sg.i], 'sdkh-elim-notes', d); byNotes++; }
      }
      chip.textContent = `only ${sg.d} fits here` + (byNotes ? ` · ✎ = erased in your notes` : '');
    } else {
      // every other cell of the unit is blocked for this digit
      const u = unitOf(sg.unit);
      shade(u, sg.i);
      for (const j of u.cells) {
        if (j === sg.i || st.grid[j]) continue;
        const w = whyNot(j, sg.d, st, a, u.name);
        if (/^(row|column|box) /.test(w.key)) { ring(blockerIn(w.key, sg.d)); cross(j, 'sdkh-no'); }
        else if (w.key.startsWith('h')) { cross(j, 'sdkh-no sdkh-no-hint'); usedHints.add(+w.key.slice(1)); }
        else { cross(j, 'sdkh-no sdkh-no-notes'); byNotes++; }   // erased in the player's own notes
      }
      chip.textContent = `only place for ${sg.d} in ${sg.unit}` + (byNotes ? ` · ✎ = erased in your notes` : '');
    }
    // earlier hints that were needed: just their cells, outlined
    for (const h of usedHints) {
      const hint = a.hints[h];
      for (const i of hint.cells) {
        cells[i].classList.add('sdkh-hintcell');
        hintDigitsIn(hint, i, a).forEach((d) => mark(cells[i], 'sdkh-hintdigit', d));   // what the hint is about, e.g. 3·4·7
      }
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
      let hit = null;
      if (i != null && cells[i].style.visibility !== 'hidden' && !(e.target && e.target.closest && e.target.closest('.sdkh-panel'))) {
        if (singleShown(i) && last.singles.some((sg) => sg.i === i)) hit = { cat: 'single', i };
        else for (const cat of GROUP_CATS) {
          if (opts.show[cat] && last.groups[cat].some((g) => g.cells.includes(i))) { hit = { cat, i }; break; }
        }
      }
      if (JSON.stringify(hit) !== JSON.stringify(gridHover)) { gridHover = hit; render(true); }
    });
  }, { passive: true, capture: true });
  document.addEventListener('mouseleave', () => { if (gridHover != null) { gridHover = null; render(true); } });

  // ---------------------------------------------------------------- panel
  const panel = document.createElement('div');
  panel.className = 'sdkh-panel';
  panel.innerHTML = `
    <div class="sdkh-head" title="Drag the panel to move it · double-click here to put it back top-right"><span>⠿ Sudoku Hint Panel</span><b class="sdkh-grade" hidden></b><button class="sdkh-min" title="Collapse / expand">–</button></div>
    <div class="sdkh-body">
      <div class="sdkh-fair" hidden>
        <b>Learn at your own level</b>
        <p>Open only as much as you need: a count, one technique, or a single hint with its reasoning — so next time you spot it yourself. Regular games also count for sudoku.com tournaments and leaderboards: play those on your own.</p>
        <button class="sdkh-fair-ok">Got it</button>
      </div>
      <div class="sdkh-sec sdkh-sec-first"><b>1 · Notes</b><small>no answers given</small></div>
      <div class="sdkh-actions">
        <button data-act="cand" title="Alt+Shift+C — set every empty cell's notes to its possible digits">✎ Candidates</button>
        <button data-act="opt" title="Alt+Shift+N — notes with everything pairs, triples and pointing erase already erased (chained until nothing changes)">✎ Optimized</button>
      </div>
      <div class="sdkh-sec"><b>2 · Step by step assist</b><small>one at a time</small></div>
      <div class="sdkh-actions">
        <button data-act="assist" class="sdkh-assist-btn" title="Alt+Shift+A — one hint at a time, easiest first: where to look, then what, then why">🧭 Assist</button>
        <button data-act="one" class="sdkh-one-btn" title="Alt+Shift+O — show ONE single option on the grid (the easiest first); click again for another">☝ ONE single</button>
      </div>
      <div class="sdkh-assist" hidden></div>
      <div class="sdkh-pin" hidden></div>
      <div class="sdkh-sec"><b>3 · Fill in</b><small>answers typed for you</small></div>
      <div class="sdkh-actions">
        <button data-act="fill" title="Alt+Shift+F — type the digit into every single-option cell">⚡ Fill singles</button>
        <button data-act="finish" class="sdkh-finish-btn" title="Types the rest of the solution one digit at a time, in the order you could find it: simplest techniques first (click twice to confirm)">🏁 Finish grid</button>
      </div>
      <div class="sdkh-sec sdkh-sec-adv" title="Show / hide all the hint categories"><b><span class="sdkh-fold">▸</span> 4 · Advanced</b><small>all hints at once</small><i class="sdkh-adv-count"></i></div>
      <div class="sdkh-summary"></div>
      <div class="sdkh-cats">${CATS.filter((c) => !c.expert).map(CAT_HTML).join('')}
        <div class="sdkh-expert-head" title="Harder techniques, used only when nothing simpler helps"><span class="sdkh-fold">▸</span><span>Expert techniques</span><b class="sdkh-count"></b></div>
        <div class="sdkh-expert">${CATS.filter((c) => c.expert).map(CAT_HTML).join('')}</div>
      </div>
      <div class="sdkh-status"></div>
    </div>`;
  document.body.appendChild(panel);

  const summaryEl = panel.querySelector('.sdkh-summary');
  summaryEl.addEventListener('mouseenter', () => { if (summaryEl.classList.contains('sdkh-badnotes')) { showBadNotes = true; render(true); } });
  summaryEl.addEventListener('mouseleave', () => { if (showBadNotes) { showBadNotes = false; render(true); } });
  const pinEl = panel.querySelector('.sdkh-pin');
  const assistEl = panel.querySelector('.sdkh-assist');
  const assistBtn = panel.querySelector('.sdkh-assist-btn');
  const CAT_NAME = Object.fromEntries(CATS.map((c) => [c.id, c.label]));
  let lastCard = '';
  function renderAssistCard(cur, a) {
    let html = '';
    if (assist.on) {
      if (!cur) html = `<div class="sdkh-assist-text">No hint left with these techniques — over to you.</div>
        <div class="sdkh-assist-btns"><button data-as="stop">Stop</button></div>`;
      else {
        const x = cur.item, u = assistUnit(cur);
        const virtual = cur.cat !== 'single' && !a.usesNotes;   // nothing to erase in the game's notes
        const text = assist.level === 1 ? (cur.cat === 'single' ? `Something to find in <b>${u.name}</b>.` : hintLook(x).text)
          : assist.level === 2 ? `<b>${CAT_NAME[cur.cat]}</b> — ${assistWhat(cur)}.<br>`
            + (cur.cat === 'single' ? `Type ${x.d} in the green cell.` : virtual ? 'Keep it in mind, then go on.' : 'Erase the notes circled in red.')
          : 'Why: ' + (cur.cat === 'single' ? 'drawn on the grid.' : hintWhy(x).replace(/^[A-Z](?![A-Z-])/, (m) => m.toLowerCase()));
        const more = assist.level === 1 ? 'Show what' : assist.level === 2 ? 'Show why' : '';
        html = `<div class="sdkh-assist-head">🧭 Hint ${assist.shown}${x.step > 1 ? ` <small class="sdkh-step">step ${x.step}</small>` : ''}</div>
          <div class="sdkh-assist-text">${text}</div>
          <div class="sdkh-assist-btns">${more ? `<button data-as="more" class="sdkh-as-more">${more}</button>` : ''}
            <button data-as="skip">${virtual && assist.level > 1 ? 'Next ›' : 'Skip ›'}</button><button data-as="stop" title="Leave assist mode">✕</button></div>`;
      }
    }
    if (html === lastCard) return;
    lastCard = html;
    assistEl.innerHTML = html;
    assistEl.hidden = !assist.on;
    assistBtn.classList.toggle('sdkh-on', assist.on);
    clampPanel();
  }
  function setAssist(on) {
    assist.on = on;
    assist.key = null; assist.level = 1; assist.skipped.clear(); assist.shown = 0;
    if (on) { pin = null; for (const c of CATS) opts.show[c.id] = false; syncUi(); status(''); }
    else renderAssistCard(null, null);
    opts.assist = on; saveOpts();
    render(true);
  }
  function assistMore() { if (assist.on && assist.key && assist.level < 3) { assist.level++; render(true); } }
  function assistSkip() {
    if (!assist.on || !assist.key) return;
    assist.skipped.add(assist.key);
    assist.key = null;
    render(true);
  }
  // one-time fair-play notice
  const fairEl = panel.querySelector('.sdkh-fair');
  try { fairEl.hidden = localStorage.getItem('sdkh_fairplay_ok') === '1'; } catch (e) { fairEl.hidden = false; }
  const statusEl = panel.querySelector('.sdkh-status');
  const headEl = panel.querySelector('.sdkh-head');
  const gradeEl = panel.querySelector('.sdkh-grade');
  // grade of what's left, worked out after the panel is drawn (cached per grid)
  const gradeCache = new Map();
  let gradeKey = '', gradeTimer = 0, gradeShown = null;   // last shown: { key, score }
  function showGrade(g) {
    gradeEl.hidden = g == null;
    if (g == null) return;
    const n = g.score;
    gradeEl.textContent = `${n}/10`;
    gradeEl.dataset.g = n;
    gradeEl.style.setProperty('--h', String(Math.round(130 - (n - 1) * 13)));   // green → red
    gradeEl.title = n === 0 ? 'Grid solved: 0/10'
      : `What's left is like a sudoku.com ${GRADE_LEVELS[n - 1]} grid: ${n}/10 (1-2 Easy · 3-4 Medium · 5-6 Hard · 7-8 Expert · 9-10 Extreme).\n`
        + `Hardest step needed: ${TECH_NAMES[g.tech]}. It goes down as you fill the grid.`;
  }
  // Filling a correct digit can, rarely, reshuffle the easiest path and give a
  // score one higher; while digits are only added, the badge never goes up.
  function showGradeFor(key, g) {
    const prev = gradeShown;
    const grew = prev && g && [...prev.key].every((c, i) => c === '0' || c === key[i]);
    const shown = grew && prev.score < g.score ? { ...g, score: prev.score } : g;
    gradeShown = g ? { key, score: shown.score } : null;
    showGrade(shown);
  }
  function updateGrade(st) {
    if (!st || st.error || pageInfo().type === 'killer') { gradeKey = ''; gradeShown = null; showGrade(null); return; }   // killer: cages aren't used
    const key = st.grid.join('');
    if (key === gradeKey) return;
    gradeKey = key;
    if (gradeCache.has(key)) { showGradeFor(key, gradeCache.get(key)); return; }
    clearTimeout(gradeTimer);
    gradeTimer = setTimeout(() => {
      const g = gradeGrid(st.grid);
      if (gradeCache.size > 200) gradeCache.clear();
      gradeCache.set(key, g);
      if (gradeKey === key) showGradeFor(key, g);
    }, 30);
  }
  const minBtn = panel.querySelector('.sdkh-min');
  const catEls = Object.fromEntries(CATS.map((c) => [c.id, panel.querySelector(`.sdkh-cat[data-cat="${c.id}"]`)]));
  const expertHead = panel.querySelector('.sdkh-expert-head');
  const advHead = panel.querySelector('.sdkh-sec-adv');
  const advCountEl = advHead.querySelector('.sdkh-adv-count');
  const expertCountEl = expertHead.querySelector('.sdkh-count');
  let statusTimer;

  function status(msg, kind = '') {
    statusEl.textContent = msg;
    statusEl.className = 'sdkh-status ' + (kind ? 'sdkh-' + kind : '');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 6000);
  }

  // step 1 = visible on the board as it is; step n = needs the erasures of earlier hints
  const stepTag = (n) => (n > 1 ? `<small class="sdkh-step">step ${n}</small>` : '<small></small>');
  const lastItems = {};
  function renderPanel(res, error) {
    if (!res) {
      summaryEl.textContent = error || '';
      summaryEl.className = 'sdkh-summary sdkh-err';
      for (const c of CATS) { catEls[c.id].querySelector('.sdkh-count').textContent = '–'; setItems(c.id, ''); }
      expertCountEl.textContent = '–';
      advCountEl.textContent = '';
      return;
    }
    const counts = { single: res.singles.length };
    for (const c of GROUP_CATS) counts[c] = res.groups[c].length;
    const total = Object.values(counts).reduce((x, y) => x + y, 0);
    const expertN = CATS.filter((c) => c.expert).reduce((x, c) => x + counts[c.id], 0);
    expertCountEl.textContent = String(expertN);
    advCountEl.textContent = String(total);
    advHead.classList.toggle('sdkh-has', total > 0);
    expertHead.classList.toggle('sdkh-has', expertN > 0);
    const bad = res.badNotes || [];
    summaryEl.className = 'sdkh-summary' + (res.dead.length ? ' sdkh-err' : bad.length ? ' sdkh-warn sdkh-badnotes' : total ? ' sdkh-yes' : '');
    summaryEl.textContent = res.dead.length ? `⚠ ${res.dead.length} cell${res.dead.length > 1 ? 's have' : ' has'} no possible digit — check for a mistake.`
      : bad.length ? `⚠ ${bad.length === 1 ? 'One note was' : bad.length + ' notes were'} erased by mistake, so hints use the placed digits only. Hover here to see where.`
      : total ? 'Help available:' : 'No help found with these techniques.';
    for (const c of CATS) {
      const el = catEls[c.id];
      el.querySelector('.sdkh-count').textContent = String(counts[c.id]);
      el.classList.toggle('sdkh-has', counts[c.id] > 0);
      el.classList.toggle('sdkh-off', !opts.show[c.id]);
      const html = '';   // hints are shown on the grid only; the panel keeps the counts
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
    panel.classList.toggle('sdkh-expert-open', !!opts.expert);
    panel.classList.toggle('sdkh-adv-open', !!opts.advanced);
    advHead.querySelector('.sdkh-fold').textContent = opts.advanced ? '▾' : '▸';
    expertHead.querySelector('.sdkh-fold').textContent = opts.expert ? '▾' : '▸';
    panel.classList.toggle('sdkh-collapsed', !!opts.collapsed);
    minBtn.textContent = opts.collapsed ? '+' : '–';
  }

  const toggleCat = (cat) => {
    opts.show[cat] = !opts.show[cat];
    if (opts.show[cat]) opts.advanced = true;   // a shortcut unfolds the section it belongs to
    if (opts.show[cat] && CATS.find((c) => c.id === cat).expert) opts.expert = true;
    focus = null;
    saveOpts(); syncUi(); render(true);
  };

  // Hover a category title to see only that category on the grid.
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
    if (e.target.closest('.sdkh-sec-adv')) {
      opts.advanced = !opts.advanced;
      if (!opts.advanced) { for (const c of CATS) opts.show[c.id] = false; focus = null; }   // folded: nothing of it stays on the grid
      saveOpts(); syncUi(); clampPanel(); render(true); return;
    }
    if (e.target.closest('.sdkh-expert-head')) { opts.expert = !opts.expert; saveOpts(); syncUi(); clampPanel(); return; }
    if (e.target.closest('.sdkh-cat-head')) { if (assist.on) setAssist(false); toggleCat(e.target.closest('.sdkh-cat').dataset.cat); return; }
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
    if (b.dataset.as === 'more') { assistMore(); return; }
    if (b.dataset.as === 'skip') { assistSkip(); return; }
    if (b.dataset.as === 'stop') { setAssist(false); return; }
    if (b.dataset.act === 'assist') { setAssist(!assist.on); return; }
    if (b.dataset.act === 'one') { if (assist.on) setAssist(false); pickOne(); return; }
    if (b.dataset.act === 'cand') run(() => fillCandidates(false));
    else if (b.dataset.act === 'opt') run(() => fillCandidates(true));
    else if (b.dataset.act === 'fill') run(fillSingles);
    else if (b.dataset.act === 'finish') finishClick(b);
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
    const map = { KeyC: () => run(() => fillCandidates(false)), KeyN: () => run(() => fillCandidates(true)), KeyF: () => run(fillSingles), KeyO: () => { if (assist.on) setAssist(false); pickOne(); }, KeyA: () => (assist.on ? assistMore() : setAssist(true)),
      KeyH: () => toggleCat('single'), KeyP: () => toggleCat('subsets'), KeyL: () => toggleCat('pointing'), KeyK: () => toggleCat('coloring') };
    if (map[e.code]) { e.preventDefault(); e.stopPropagation(); map[e.code](); }
  }, true);

  syncUi();
  const saved = loadPos();
  if (saved) placePanel(saved.x, saved.y);
  render(true);

  // Live updates: page-bridge.js signals every time the game saves a move;
  // the 250 ms poll is only a fallback.
  document.addEventListener('sdkh-game-saved', () => { if (!busy) render(false); });
  if (opts.assist) setAssist(true);   // assist mode stays on across visits
  setInterval(() => { if (!busy) render(false); }, 250);
  window.addEventListener('scroll', () => render(false), { passive: true });
  window.addEventListener('resize', () => { clampPanel(); render(false); });
})();
