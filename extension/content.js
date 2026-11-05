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
  // hint kind -> panel category, categories from simplest to hardest
  const CAT_OF = { pointing: 'pointing', pair: 'subsets', triple: 'subsets', 'hidden pair': 'subsets', 'hidden triple': 'subsets',
    coloring: 'coloring', quad: 'quads', 'hidden quad': 'quads', 'x-wing': 'fish', swordfish: 'fish', jellyfish: 'fish',
    'xy-wing': 'wings', 'xyz-wing': 'wings', 'w-wing': 'wings', ur: 'ur', 'x-chain': 'chains', 'xy-chain': 'chains', forcing: 'forcing' };
  const GROUP_CATS = ['pointing', 'subsets', 'coloring', 'quads', 'fish', 'wings', 'ur', 'chains', 'forcing'];

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

  function effectiveCands(st, useNotes) {
    const raw = candidates(st.grid);
    if (!useNotes) return raw;
    return raw.map((c, i) => (c && st.notes[i].size ? new Set([...c].filter((d) => st.notes[i].has(d))) : c));
  }

  // The puzzle's solution (backtracking on the fewest-candidates cell), cached
  // per grid. null when the placed digits allow no solution (a wrong digit).
  let solCache = { key: '', sol: null };
  function solveGrid(grid) {
    const key = grid.join('');
    if (solCache.key === key) return solCache.sol;
    const g = grid.slice();
    let budget = 200000;
    const go = () => {
      if (--budget < 0) return false;
      let best = -1, bestC = null;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const c = [];
        for (let d = 1; d <= 9; d++) if (!PEERS[i].some((p) => g[p] === d)) c.push(d);
        if (!c.length) return false;
        if (!bestC || c.length < bestC.length) { best = i; bestC = c; if (c.length === 1) break; }
      }
      if (best < 0) return true;
      for (const d of bestC) { g[best] = d; if (go()) return true; }
      g[best] = 0;
      return false;
    };
    const sol = go() ? g : null;
    solCache = { key, sol };
    return sol;
  }

  // Notes are trusted only if complete AND none of them rules out a cell's
  // real digit. A note erased by mistake would otherwise produce wrong hints
  // (and Fill singles would type a wrong digit). badNotes = those cells.
  function notesCheck(st) {
    if (!notesComplete(st)) return { use: false, bad: [] };
    const sol = solveGrid(st.grid);
    if (!sol) return { use: true, bad: [] };
    const bad = [];
    for (let i = 0; i < 81; i++) if (!st.grid[i] && !st.notes[i].has(sol[i])) bad.push(i);
    return { use: !bad.length, bad };
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

  // Hidden pairs / triples: N digits that, in one unit, fit in only the same N
  // cells. Those cells must hold these digits, so their other notes can be erased.
  function findHidden(cand) {
    const byKey = new Map();
    for (const u of UNITS) {
      const where = {};   // digit -> its candidate cells in this unit (2 or 3 of them)
      for (let d = 1; d <= 9; d++) {
        const cs = u.cells.filter((i) => cand[i] && cand[i].has(d));
        if (cs.length >= 2 && cs.length <= 3) where[d] = cs;
      }
      const ds = Object.keys(where).map(Number);
      const pairs = new Set();   // hidden pairs of this unit: a triple containing one adds nothing
      const consider = (digits, kind) => {
        if (kind === 'hidden triple' && [[0, 1], [0, 2], [1, 2]].some(([x, y]) => pairs.has(digits[x] + ',' + digits[y]))) return;
        const cells = [...new Set(digits.flatMap((d) => where[d]))].sort((a, b) => a - b);
        if (cells.length !== digits.length) return;
        if (kind === 'hidden pair') pairs.add(digits.join(','));
        const key = cells.join(',') + ':' + digits.join('');
        let g = byKey.get(key);
        if (!g) {
          g = { kind, cells, digits, units: [], elims: new Map() };
          for (const i of cells) {
            const rest = [...cand[i]].filter((d) => !digits.includes(d)).sort();
            if (rest.length) g.elims.set(i, rest);
          }
          byKey.set(key, g);
        }
        g.units.push(u.name);
      };
      for (let a = 0; a < ds.length; a++)
        for (let b = a + 1; b < ds.length; b++) consider([ds[a], ds[b]], 'hidden pair');
      for (let a = 0; a < ds.length; a++)
        for (let b = a + 1; b < ds.length; b++)
          for (let c = b + 1; c < ds.length; c++) consider([ds[a], ds[b], ds[c]], 'hidden triple');
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
    // the other way round (sudoku.com also calls it "pointing"; aka claiming):
    // all of a row's or column's candidates for a digit lie in one box → that
    // digit can be erased from the rest of the box, outside the line.
    for (let l = 0; l < 18; l++) {
      const line = UNITS[l];
      for (let d = 1; d <= 9; d++) {
        const cs = line.cells.filter((i) => cand[i] && cand[i].has(d));
        if (cs.length < 2) continue;
        const b = boxOf(cs[0]);
        if (!cs.every((i) => boxOf(i) === b)) continue;
        const box = UNITS[18 + b];
        const elims = new Map();
        for (const j of box.cells) {
          if (line.cells.includes(j) || !cand[j] || !cand[j].has(d)) continue;
          elims.set(j, [d]);
        }
        if (elims.size) out.push({ kind: 'pointing', cells: cs, digits: [d], units: [`${line.name} → ${box.name}`], elims });
      }
    }
    return out;
  }
  function boxOf(i) { return Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3); }

  // Chains on one digit ("coloring"). Where a row, column or box has only two
  // places for d, exactly one of them is d: link them. Following the links,
  // the cells alternate between two colours, and one colour holds all the d's.
  //  - wrap: two cells of the same colour share a unit → that colour is wrong,
  //    d is erased from all its cells;
  //  - trap: a cell outside the chain sees both colours → d is erased there.
  function findColoring(cand) {
    const out = [];
    for (let d = 1; d <= 9; d++) {
      const adj = new Map(), unitOfLink = new Map();
      for (const u of UNITS) {
        const cs = u.cells.filter((i) => cand[i] && cand[i].has(d));
        if (cs.length !== 2) continue;
        const [x, y] = cs;
        if (!adj.has(x)) adj.set(x, new Set());
        if (!adj.has(y)) adj.set(y, new Set());
        adj.get(x).add(y); adj.get(y).add(x);
        const k = Math.min(x, y) + ',' + Math.max(x, y);
        if (!unitOfLink.has(k)) unitOfLink.set(k, u.name);
      }
      const done = new Set();
      for (const start of adj.keys()) {
        if (done.has(start)) continue;
        const colorOf = new Map([[start, 0]]), stack = [start];
        while (stack.length) {
          const x = stack.pop();
          for (const y of adj.get(x)) if (!colorOf.has(y)) { colorOf.set(y, 1 - colorOf.get(x)); stack.push(y); }
        }
        colorOf.forEach((_, c) => done.add(c));
        if (colorOf.size < 3) continue;
        const chain = [...colorOf.keys()].sort((a, b) => a - b);
        const links = [...unitOfLink.keys()].map((k) => k.split(',').map(Number)).filter(([a]) => colorOf.has(a));
        const units = [...new Set(links.map(([a, b]) => unitOfLink.get(a + ',' + b)))];
        const base = { kind: 'coloring', cells: chain, digits: [d], units, links, colorOf };
        let wrap = null;
        for (const k of [0, 1]) {
          const grp = chain.filter((c) => colorOf.get(c) === k);
          const u = UNITS.find((uu) => grp.filter((c) => uu.cells.includes(c)).length > 1);
          if (u) { wrap = { k, u }; break; }
        }
        if (wrap) {
          const elims = new Map(chain.filter((c) => colorOf.get(c) === wrap.k).map((c) => [c, [d]]));
          out.push({ ...base, rule: 'wrap', falseColor: wrap.k, wrapUnit: wrap.u.name, elims });
          continue;
        }
        const elims = new Map();
        for (let i = 0; i < 81; i++) {
          if (!cand[i] || !cand[i].has(d) || colorOf.has(i)) continue;
          const seen = new Set(PEERS[i].filter((p) => colorOf.has(p)).map((p) => colorOf.get(p)));
          if (seen.size === 2) elims.set(i, [d]);
        }
        if (elims.size) out.push({ ...base, rule: 'trap', elims });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- expert techniques
  // Each finder returns hints shaped like the others: { kind, cells, digits,
  // units, elims: Map(cell -> [digits]) } plus what its drawing needs. They are
  // only tried when every simpler technique finds nothing (see analyse).
  const ROWS = UNITS.slice(0, 9), COLS = UNITS.slice(9, 18);
  const sees = (i, j) => i !== j && PEERS[i].includes(j);
  const has = (cand, i, d) => !!(cand[i] && cand[i].has(d));
  function combos(arr, n, start = 0, acc = [], out = []) {
    if (acc.length === n) { out.push(acc.slice()); return out; }
    for (let k = start; k < arr.length; k++) { acc.push(arr[k]); combos(arr, n, k + 1, acc, out); acc.pop(); }
    return out;
  }
  const addElim = (elims, j, d) => { const l = elims.get(j) || []; if (!l.includes(d)) l.push(d); elims.set(j, l.sort()); };

  // Naked quads (4 cells, 4 digits) and hidden quads (4 digits, 4 cells).
  function findQuads(cand) {
    const out = [], keys = new Set();
    for (const u of UNITS) {
      const open = u.cells.filter((i) => cand[i] && cand[i].size >= 2 && cand[i].size <= 4);
      for (const cs of combos(open, 4)) {
        const union = new Set(); cs.forEach((i) => cand[i].forEach((d) => union.add(d)));
        if (union.size !== 4) continue;
        const elims = new Map();
        for (const j of u.cells) if (!cs.includes(j) && cand[j]) union.forEach((d) => { if (cand[j].has(d)) addElim(elims, j, d); });
        const key = 'q' + cs.join(',');
        if (elims.size && !keys.has(key)) { keys.add(key); out.push({ kind: 'quad', cells: cs, digits: [...union].sort(), units: [u.name], elims }); }
      }
      const where = {};
      for (let d = 1; d <= 9; d++) { const cs = u.cells.filter((i) => has(cand, i, d)); if (cs.length >= 2 && cs.length <= 4) where[d] = cs; }
      for (const ds of combos(Object.keys(where).map(Number), 4)) {
        const cells = [...new Set(ds.flatMap((d) => where[d]))].sort((a, b) => a - b);
        if (cells.length !== 4) continue;
        const elims = new Map();
        for (const i of cells) cand[i].forEach((d) => { if (!ds.includes(d)) addElim(elims, i, d); });
        const key = 'h' + cells.join(',');
        if (elims.size && !keys.has(key)) { keys.add(key); out.push({ kind: 'hidden quad', cells, digits: ds, units: [u.name], elims }); }
      }
    }
    return out;
  }

  // Fish: in n rows, digit d fits only within the same n columns (or the other
  // way round). Each of those columns gets its d from these rows, so d goes
  // from the rest of the columns. n = 2 X-wing, 3 swordfish, 4 jellyfish.
  const FISH = { 2: 'x-wing', 3: 'swordfish', 4: 'jellyfish' };
  function findFish(cand, sizes) {
    const out = [];
    for (const n of sizes) {
      for (let d = 1; d <= 9; d++) {
        for (const [bases, covers] of [[ROWS, COLS], [COLS, ROWS]]) {
          const pos = bases.map((u) => u.cells.filter((i) => has(cand, i, d)));
          const lines = range9.filter((k) => pos[k].length >= 2 && pos[k].length <= n);
          for (const bs of combos(lines, n)) {
            const coverIdx = new Set();
            bs.forEach((k) => pos[k].forEach((i) => coverIdx.add(bases === ROWS ? i % 9 : Math.floor(i / 9))));
            if (coverIdx.size !== n) continue;
            const baseCells = new Set(bs.flatMap((k) => bases[k].cells));
            const elims = new Map();
            coverIdx.forEach((c) => covers[c].cells.forEach((j) => { if (!baseCells.has(j) && has(cand, j, d)) addElim(elims, j, d); }));
            if (!elims.size) continue;
            out.push({ kind: FISH[n], cells: bs.flatMap((k) => pos[k]).sort((a, b) => a - b), digits: [d],
              units: [...bs.map((k) => bases[k].name), ...[...coverIdx].sort().map((c) => covers[c].name)], base: bs.map((k) => bases[k].name), elims });
          }
        }
      }
    }
    return out;
  }

  // Wings.
  //  XY-wing: a pivot with two notes x·y sees two cells x·z and y·z. Whichever
  //    the pivot is, one of those two is z → cells seeing both lose z.
  //  XYZ-wing: same with a pivot x·y·z: the pivot itself can also be z, so only
  //    cells seeing all three lose z.
  //  W-wing: two x·y cells that don't see each other, and an x that has only two
  //    places in some unit, one seeing each → one of the two is y.
  function findWings(cand) {
    const out = [], keys = new Set();
    const bi = range9.flatMap((r) => range9.map((c) => r * 9 + c)).filter((i) => cand[i] && cand[i].size === 2);
    const tri = range9.flatMap((r) => range9.map((c) => r * 9 + c)).filter((i) => cand[i] && cand[i].size === 3);
    const push = (kind, cells, digits, z, targets) => {
      const elims = new Map();
      for (let j = 0; j < 81; j++) if (!cells.includes(j) && has(cand, j, z) && targets.every((t) => sees(j, t))) addElim(elims, j, z);
      const key = kind + cells.slice().sort((a, b) => a - b).join(',') + ':' + z;
      if (elims.size && !keys.has(key)) { keys.add(key); out.push({ kind, cells, digits, units: [], elims, z }); }
    };
    for (const p of bi) {
      const [x, y] = [...cand[p]];
      const wa = bi.filter((a) => sees(p, a) && cand[a].has(x) && !cand[a].has(y));
      const wb = bi.filter((b) => sees(p, b) && cand[b].has(y) && !cand[b].has(x));
      for (const a of wa) for (const b of wb) {
        const za = [...cand[a]].find((d) => d !== x), zb = [...cand[b]].find((d) => d !== y);
        if (za === zb) push('xy-wing', [p, a, b], [x, y, za].sort(), za, [a, b]);
      }
    }
    for (const p of tri) {
      const ws = bi.filter((a) => sees(p, a) && [...cand[a]].every((d) => cand[p].has(d)));
      for (const [a, b] of combos(ws, 2)) {
        const common = [...cand[a]].filter((d) => cand[b].has(d));
        if (common.length !== 1 || new Set([...cand[a], ...cand[b]]).size !== 3) continue;
        push('xyz-wing', [p, a, b], [...cand[p]].sort(), common[0], [p, a, b]);
      }
    }
    for (const [a, b] of combos(bi, 2)) {
      if (sees(a, b) || [...cand[a]].join() !== [...cand[b]].join()) continue;
      for (const x of cand[a]) {
        const y = [...cand[a]].find((d) => d !== x);
        for (const u of UNITS) {
          const cs = u.cells.filter((i) => has(cand, i, x));
          if (cs.length !== 2 || cs.includes(a) || cs.includes(b)) continue;
          const [c1, c2] = cs;
          if ((sees(c1, a) && sees(c2, b)) || (sees(c1, b) && sees(c2, a))) {
            const g0 = out.length;
            push('w-wing', [a, b, c1, c2], [x, y].sort(), y, [a, b]);
            if (out.length > g0) { out[out.length - 1].units = [u.name]; out[out.length - 1].links = [[c1, c2, x]]; }
          }
        }
      }
    }
    return out;
  }

  // Unique rectangle (type 1): four cells on two rows, two columns and two boxes,
  // three of them holding only a·b. If the fourth were a or b too, a and b
  // could swap and the puzzle would have two solutions → it loses a and b.
  function findRectangles(cand) {
    const out = [];
    for (const [r1, r2] of combos(range9, 2)) for (const [c1, c2] of combos(range9, 2)) {
      const cs = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
      const boxes = new Set(cs.map((i) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3)));
      if (boxes.size !== 2 || !cs.every((i) => cand[i])) continue;
      const pairCells = cs.filter((i) => cand[i].size === 2);
      if (pairCells.length !== 3) continue;
      const pair = [...cand[pairCells[0]]].sort();
      if (!pairCells.every((i) => [...cand[i]].sort().join() === pair.join())) continue;
      const odd = cs.find((i) => !pairCells.includes(i));
      if (!pair.every((d) => cand[odd].has(d)) || cand[odd].size < 3) continue;
      out.push({ kind: 'ur', cells: cs.sort((a, b) => a - b), digits: pair, units: [], elims: new Map([[odd, pair]]) });
    }
    return out;
  }

  // Long chains: alternating strong links (only two places) and weak links
  // (two cells that see each other). If either end of the chain must be d,
  // cells seeing both ends lose d.
  //  X-chain: one digit throughout.
  //  XY-chain: cells with two notes; each passes the "other" digit on.
  const MAX_CHAIN = 12;
  function findChains(cand) {
    const out = [], keys = new Set();
    for (let d = 1; d <= 9; d++) {   // X-chains
      const strong = new Map();
      for (const u of UNITS) {
        const cs = u.cells.filter((i) => has(cand, i, d));
        if (cs.length !== 2) continue;
        for (const [p, q] of [cs, cs.slice().reverse()]) { if (!strong.has(p)) strong.set(p, new Set()); strong.get(p).add(q); }
      }
      const withD = range9.flatMap((r) => range9.map((c) => r * 9 + c)).filter((i) => has(cand, i, d));
      for (const s of strong.keys()) {
        // BFS on (cell, last link was strong?) starting with a strong link out of s
        const prev = new Map(), q = [];
        for (const t of strong.get(s)) { const k = t + ':1'; prev.set(k, s + ':0'); q.push([t, 1, 1]); }
        while (q.length) {
          const [c, lastStrong, len] = q.shift();
          if (lastStrong && len >= 3) {   // a chain s = … = c: one of s, c is d
            const elims = new Map();
            for (const j of withD) if (j !== s && j !== c && sees(j, s) && sees(j, c)) addElim(elims, j, d);
            const key = 'x' + d + ':' + Math.min(s, c) + ',' + Math.max(s, c);
            if (elims.size && !keys.has(key)) {
              keys.add(key);
              const path = [c]; let k = c + ':1';
              while (prev.has(k)) { const pk = prev.get(k); path.push(+pk.split(':')[0]); k = pk; if (+pk.split(':')[0] === s && pk.endsWith(':0')) break; }
              path.reverse();
              const links = path.slice(1).map((v, n) => [path[n], v, d]);
              out.push({ kind: 'x-chain', cells: [...new Set(path)], digits: [d], units: [], links, ends: [s, c], elims,
                colorOf: new Map(path.map((v, n) => [v, n % 2])) });
            }
          }
          if (len >= MAX_CHAIN) continue;
          const nexts = lastStrong ? withD.filter((j) => sees(c, j)) : [...(strong.get(c) || [])];
          for (const j of nexts) {
            const k = j + ':' + (lastStrong ? 0 : 1);
            if (prev.has(k) || j === s) continue;
            prev.set(k, c + ':' + lastStrong);
            q.push([j, lastStrong ? 0 : 1, len + 1]);
          }
        }
      }
    }
    const bi = range9.flatMap((r) => range9.map((c) => r * 9 + c)).filter((i) => cand[i] && cand[i].size === 2);
    for (const s of bi) for (const a of cand[s]) {   // XY-chains: assume s isn't a
      const other = (i, d) => [...cand[i]].find((x) => x !== d);
      const start = other(s, a);
      const prev = new Map([[s + ':' + start, null]]), q = [[s, start, 1]];
      while (q.length) {
        const [c, t, len] = q.shift();   // t: the digit c must then be
        if (c !== s && t === a && len >= 3) {
          const elims = new Map();
          for (let j = 0; j < 81; j++) if (j !== s && j !== c && has(cand, j, a) && sees(j, s) && sees(j, c)) addElim(elims, j, a);
          const key = 'y' + a + ':' + Math.min(s, c) + ',' + Math.max(s, c);
          if (elims.size && !keys.has(key)) {
            keys.add(key);
            const states = []; let k = c + ':' + t;
            while (k) { states.push(k.split(':').map(Number)); k = prev.get(k); }
            states.reverse();
            const path = states.map(([cell]) => cell);
            const links = states.slice(1).map(([cell], n) => [states[n][0], cell, states[n][1]]);   // passes the digit the earlier cell holds
            out.push({ kind: 'xy-chain', cells: path, digits: [a], units: [], links, ends: [s, c], elims,
              colorOf: new Map(path.map((v, n) => [v, n % 2])), cellDigits: new Map(path.map((v) => [v, [...cand[v]].sort()])) });
          }
        }
        if (len >= MAX_CHAIN) continue;
        for (const j of bi) {
          if (!sees(c, j) || !cand[j].has(t)) continue;
          const nt = other(j, t), k = j + ':' + nt;
          if (prev.has(k)) continue;
          prev.set(k, c + ':' + t);
          q.push([j, nt, len + 1]);
        }
      }
    }
    return out;
  }

  // Forcing chain (contradiction): if this cell held d, the singles that follow
  // would leave a cell with no digit, or a digit with no place in a unit — so
  // it can't be d. The shortest such chain is shown.
  function findForcing(cand, grid) {
    const all = [];
    for (const deep of [false, true]) {   // singles only first; then also pairs, triples and pointing along the way
      const t0 = Date.now();   // the deep pass is slow: stop early once something is found
      for (let i = 0; i < 81; i++) {
        if (deep && ((all.length && Date.now() - t0 > 400) || Date.now() - t0 > 1200)) break;
        if (!cand[i] || cand[i].size < 2) continue;
        for (const d of cand[i]) {
          const r = tryDigit(cand, grid, i, d, deep);
          if (r) all.push({ i, d, deep, ...r });
        }
      }
      if (all.length) break;
    }
    // the shortest contradictions first; several at once keeps the analysis fast
    return all.sort((p, q) => p.steps.length - q.steps.length).slice(0, 12).map((b) => ({
      kind: 'forcing', cells: [b.i, ...b.steps.map(([j]) => j)], digits: [b.d], units: b.unit ? [b.unit] : [], length: b.steps.length,
      elims: new Map([[b.i, [b.d]]]), cellDigits: new Map([[b.i, [b.d]], ...b.steps.map(([j, x]) => [j, [x]])]),
      conflict: b.conflict, conflictUnit: b.unit || null, conflictDigit: b.cd || null, deep: b.deep,
    }));
  }
  // Place d in cell i, then follow naked and hidden singles. Returns the
  // placements and the contradiction, or null if none appears.
  function tryDigit(cand0, grid, i, d, deep) {
    const cand = cand0.map((c) => (c ? new Set(c) : null)), val = grid.slice(), steps = [];
    const put = (j, x) => {
      val[j] = x; cand[j] = null;
      for (const p of PEERS[j]) if (cand[p]) cand[p].delete(x);
    };
    put(i, d);
    for (let guard = 0; guard < 400; guard++) {
      for (let j = 0; j < 81; j++) if (cand[j] && cand[j].size === 0) return { steps, conflict: j };
      for (const u of UNITS) for (let x = 1; x <= 9; x++) {
        if (u.cells.some((j) => val[j] === x || (cand[j] && cand[j].has(x)))) continue;
        return { steps, conflict: null, unit: u.name, cd: x };
      }
      let move = null;
      for (let j = 0; j < 81 && !move; j++) if (cand[j] && cand[j].size === 1) move = [j, [...cand[j]][0]];
      for (let k = 0; k < UNITS.length && !move; k++) {
        const u = UNITS[k];
        for (let x = 1; x <= 9 && !move; x++) {
          if (u.cells.some((j) => val[j] === x)) continue;
          const where = u.cells.filter((j) => cand[j] && cand[j].has(x));
          if (where.length === 1) move = [where[0], x];
        }
      }
      if (!move && deep) {   // no single: let the basic techniques erase notes, then look again
        let erased = false;
        for (const g of [...findSubsets(cand), ...findHidden(cand), ...findPointing(cand)])
          for (const [j, ds] of g.elims) for (const x of ds) if (cand[j] && cand[j].has(x)) { cand[j].delete(x); erased = true; }
        if (erased) continue;
      }
      if (!move) return null;
      put(move[0], move[1]);
      steps.push(move);
    }
    return null;
  }

  // Techniques by difficulty. Each round uses the first tier that finds
  // something, so a harder technique only appears when nothing simpler helps.
  const TIERS = [
    (c) => [...findSubsets(c), ...findHidden(c), ...findPointing(c)],
    (c) => findColoring(c),
    (c) => [...findQuads(c), ...findFish(c, [2])],
    (c) => [...findFish(c, [3, 4]), ...findWings(c)],
    (c) => findRectangles(c),
    (c) => findChains(c),
    (c, grid) => findForcing(c, grid),
  ];
  const MAIN_TIERS = 2;

  // ---------------------------------------------------------------- grade
  // How hard is what's left? Solve from the placed digits, always taking the
  // easiest step available, and keep the hardest technique that was needed:
  // 0 solved · 1 only place in a box · 2 only place in a row / column ·
  // 3 only digit in a cell · 4 pointing · 5 pairs & triples · 6 chains ·
  // 7 quads, X-wing · 8 swordfish, jellyfish, wings, unique rectangles ·
  // 9 long chains · 10 forcing chains, or beyond.
  const GRADE_NAMES = ['solved', 'only place for a digit in a box', 'only place in a row or column', 'only digit left in a cell',
    'pointing', 'pairs & triples', 'chains', 'quads or X-wing', 'swordfish, jellyfish, wings or unique rectangles',
    'long chains', 'forcing chains, or beyond'];
  const GRADE_STEPS = [
    [4, (c) => findPointing(c)],
    [5, (c) => [...findSubsets(c), ...findHidden(c)]],
    [6, (c) => findColoring(c)],
    [7, (c) => [...findQuads(c), ...findFish(c, [2])]],
    [8, (c) => [...findFish(c, [3, 4]), ...findWings(c), ...findRectangles(c)]],
    [9, (c) => findChains(c)],
    [10, (c, g) => findForcing(c, g)],
  ];
  function gradeGrid(grid0) {
    if (!grid0.includes(0)) return 0;
    if (!solveGrid(grid0)) return null;   // a wrong digit on the board: no grade
    const grid = grid0.slice(), cand = candidates(grid);
    const put = (i, d) => { grid[i] = d; cand[i] = null; for (const p of PEERS[i]) if (cand[p]) cand[p].delete(d); };
    const hiddenIn = (units) => {
      const out = new Map();
      for (const u of units) for (let d = 1; d <= 9; d++) {
        if (u.cells.some((j) => grid[j] === d)) continue;
        const w = u.cells.filter((j) => cand[j] && cand[j].has(d));
        if (w.length === 1 && !out.has(w[0])) out.set(w[0], d);
      }
      return out;
    };
    let grade = 0;
    for (let guard = 0; guard < 400 && grid.includes(0); guard++) {
      if (cand.some((c) => c && c.size === 0)) return null;
      let found = hiddenIn(UNITS.slice(18)), lvl = 1;
      if (!found.size) { found = hiddenIn(UNITS.slice(0, 18)); lvl = 2; }
      if (!found.size) { found = new Map(); cand.forEach((c, i) => { if (c && c.size === 1) found.set(i, [...c][0]); }); lvl = 3; }
      if (found.size) { found.forEach((d, i) => { if (!grid[i]) put(i, d); }); grade = Math.max(grade, lvl); continue; }
      let erased = false;
      for (const [level, find] of GRADE_STEPS) {
        for (const g of find(cand, grid)) for (const [j, ds] of g.elims) for (const d of ds) if (cand[j] && cand[j].has(d)) { cand[j].delete(d); erased = true; }
        if (erased) { grade = Math.max(grade, level); break; }
      }
      if (!erased) return 10;   // beyond the techniques the panel knows
    }
    return grid.includes(0) ? 10 : grade;
  }
  function anySingle(cand, grid) {
    for (let i = 0; i < 81; i++) if (cand[i] && cand[i].size === 1) return true;
    for (const u of UNITS) for (let d = 1; d <= 9; d++) {
      if (u.cells.some((j) => grid[j] === d)) continue;
      if (u.cells.filter((j) => cand[j] && cand[j].has(d)).length === 1) return true;
    }
    return false;
  }   // what "Optimized" applies: no expert techniques

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
  let analyseCache = { key: '', a: null };
  function analyse(st, maxTier = TIERS.length) {
    const key = maxTier + '|' + st.grid.join('') + '|' + st.notes.map((n) => [...n].join('')).join(',');
    if (analyseCache.key === key) return analyseCache.a;
    const a = analyseFresh(st, maxTier);
    analyseCache = { key, a };
    return a;
  }
  function analyseFresh(st, maxTier) {
    const nc = notesCheck(st);
    const cand0 = effectiveCands(st, nc.use);
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

    for (let round = 0; round < 60; round++) {
      let found = [];
      for (let t = 0; t < maxTier && !found.length; t++) {
        if (t >= 1 && anySingle(cand, st.grid)) break;   // a single to place first: no need for harder techniques
        found = TIERS[t](cand, st.grid).filter((g) => {
          const key = g.kind + ':' + g.cells.join(',') + ':' + g.digits.join('');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      if (!found.length) break;
      for (const g of found) {         // deps from earlier rounds only
        let pairs;
        if (g.kind === 'coloring') {   // the links exist because d was erased from the rest of their units
          pairs = g.units.flatMap((n) => UNITS.find((u) => u.name === n).cells.map((j) => [j, g.digits[0]]));
        } else if (g.kind === 'pointing') {   // the digit was erased elsewhere in the source unit
          const src = UNITS.find((u) => u.name === g.units[0].split(' → ')[0]);   // box, or line when claiming
          pairs = src.cells.map((j) => [j, g.digits[0]]);
        } else if (g.kind.startsWith('hidden')) {   // its digits were erased from the unit's other cells
          const src = UNITS.find((u) => u.name === g.units[0]);
          pairs = src.cells.filter((j) => !g.cells.includes(j)).flatMap((j) => g.digits.map((d) => [j, d]));
        } else {                       // the group's cells lost other candidates
          pairs = g.cells.flatMap((i) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => [i, d]));
        }
        g.deps = depsOf(pairs);
        g.step = stepOf(g.deps);
        g.round = round;
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
      if (found.some((g) => g.kind === 'forcing')) break;   // the last resort: show it, no need to search further
    }

    // Single options on the reduced candidates:
    //  naked  = a cell with one possible digit;
    //  hidden = a digit with one possible cell in a row, column or box.
    // A cell can be a single for several reasons; keep the simplest one:
    // fewest earlier hints needed, then fewest marks to draw (a hidden single
    // shows one × per other empty cell of its unit, a naked one rules out 8 digits).
    const best = new Map(), dead = [];
    const offer = (sg) => {
      const cur = best.get(sg.i);
      const better = !cur || (sg.step - cur.step || sg.deps.length - cur.deps.length || sg.cost - cur.cost) < 0;
      if (better) best.set(sg.i, sg);
    };
    for (let i = 0; i < 81; i++) {
      if (st.grid[i]) continue;
      if (cand0[i].size === 0) { dead.push(i); continue; }
      if (cand[i].size === 1) {
        const d = [...cand[i]][0];
        const deps = depsOf([1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => [i, x]));
        offer({ i, d, kind: 'naked', unit: '', deps, step: stepOf(deps), cost: 8 });
      }
    }
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        if (u.cells.some((i) => st.grid[i] === d)) continue;
        const places = u.cells.filter((i) => cand[i] && cand[i].has(d));
        if (places.length !== 1) continue;
        const i = places[0];
        const deps = depsOf(u.cells.map((j) => [j, d]));
        const cost = u.cells.filter((j) => j !== i && !st.grid[j]).length;
        offer({ i, d, kind: 'hidden', unit: u.name, deps, step: stepOf(deps), cost });
      }
    }
    const singles = [...best.values()].map(({ cost, ...sg }) => sg);
    singles.sort((p, q) => p.step - q.step || p.i - q.i);

    // stable order for the lists: by step, then position
    const order = (p, q) => p.step - q.step || p.cells[0] - q.cells[0];
    const byCat = {};
    for (const c of GROUP_CATS) byCat[c] = hints.filter((g) => CAT_OF[g.kind] === c).sort(order);
    return { cand: cand0, singles, dead, ...byCat, hints, removedBy, usesNotes: nc.use, badNotes: nc.bad, reduced: cand };
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

  // Finish grid: type the solution into every empty cell (asks for a second click).
  async function finishGrid() {
    const st = readState();
    if (st.error) return status(st.error, 'err');
    if (pageInfo().type === 'killer') return status('Finish grid isn’t available for Killer puzzles (cages aren’t used).', 'warn');
    if (st.mistake.some(Boolean)) return status('There is a wrong digit on the board — fix it first.', 'err');
    const sol = solveGrid(st.grid);
    if (!sol) return status('No solution fits the digits on the board — check for a mistake.', 'err');
    const todo = [];
    for (let i = 0; i < 81; i++) if (!st.grid[i]) todo.push([i, sol[i]]);
    if (!todo.length) return status('The grid is already complete.', 'ok');

    const wasOn = pencilOn();
    if (!(await setPencil(false))) return status('Could not switch pencil mode off.', 'err');
    let first = true;
    for (const [i, d] of todo) {
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
    status(`Finished: ${todo.length} cell${todo.length === 1 ? '' : 's'} filled.`, 'ok');
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
  const CHAIN_NAMES = ['blue', 'orange'];
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
      // a point scrolled out of the window isn't covered by anything: the
      // drawing there is simply clipped by the window edge
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
      const el = document.elementFromPoint(x, y);
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
  // the rows / columns / boxes to shade when showing why a hint works
  function shadeOf(g) {
    if (g.kind === 'pointing') return g.units[0].split(' → ');
    if (g.kind === 'coloring') return g.wrapUnit ? [g.wrapUnit] : [];
    if (FISH_NAME[g.kind]) return g.base;
    if (g.kind === 'forcing') return g.conflictUnit ? [g.conflictUnit] : [];
    if (CAT_OF[g.kind] === 'subsets' || CAT_OF[g.kind] === 'quads') return g.units;
    return [];
  }
  const FISH_NAME = { 'x-wing': 'X-wing', swordfish: 'Swordfish', jellyfish: 'Jellyfish' };
  const WING_NAME = { 'xy-wing': 'XY-wing', 'xyz-wing': 'XYZ-wing', 'w-wing': 'W-wing' };
  const conflictText = (x) => (x.conflictUnit ? `no place left for ${x.conflictDigit} in ${x.conflictUnit}` : 'a cell would have no digit left');
  // what the hint says (chip and card, level 2)
  function hintWhat(x) {
    const d = x.digits[0], ds = x.digits.join('·');
    switch (x.kind) {
      case 'pointing': { const [from, to] = x.units[0].split(' → '); return `pointing ${d}: ${from} → ${to}`; }
      case 'coloring': return x.rule === 'wrap' ? `chain on ${d}: ${CHAIN_NAMES[x.falseColor]} would put two ${d}s in ${x.wrapUnit}` : `chain on ${d}: these cells see both colours`;
      case 'x-wing': case 'swordfish': case 'jellyfish': return `${FISH_NAME[x.kind]} on ${d}: ${x.base.join(', ')}`;
      case 'xy-wing': case 'xyz-wing': return `${WING_NAME[x.kind]}: one of the wings is ${x.z}`;
      case 'w-wing': return `W-wing ${ds}: one of the two is ${x.z}`;
      case 'ur': return `unique rectangle ${ds}`;
      case 'x-chain': return `chain on ${d}: one of the two ends is ${d}`;
      case 'xy-chain': return `XY-chain: one of the two ends is ${d}`;
      case 'forcing': return `if this were ${d}: ${conflictText(x)}`;
      default: return `${x.kind} ${ds} in ${x.units.join(' + ')}`;
    }
  }
  // why it works (card, level 3)
  function hintWhy(x) {
    const d = x.digits[0], ds = x.digits.join('·');
    switch (x.kind) {
      case 'coloring': return `Where a ${d} has only two places, one of them is the ${d}, so linked cells alternate colours and one colour holds all the ${d}s. `
        + (x.rule === 'wrap' ? `${cap(CHAIN_NAMES[x.falseColor])} would put two ${d}s in ${x.wrapUnit}, so its ${d}s go.` : `The red cells see both colours, so they can't be ${d}.`);
      case 'quad': return `These four cells hold the four digits ${ds} between them, so those digits go from the rest of the unit.`;
      case 'hidden quad': return `The digits ${ds} fit only in these four cells, so the cells' other notes go.`;
      case 'x-wing': case 'swordfish': case 'jellyfish': {
        const n = x.base.length, rows = /^row/.test(x.base[0]);
        return `In each of these ${n} ${rows ? 'rows' : 'columns'} the ${d} is in a framed cell, all within the same ${n} ${rows ? 'columns' : 'rows'}. Those ${rows ? 'columns' : 'rows'} get their ${d}s from here, so their other ${d}s go.`;
      }
      case 'xy-wing': return `The middle cell is one of its two digits; either way one of the two wings becomes ${x.z}. Cells that see both wings can't be ${x.z}.`;
      case 'xyz-wing': return `The middle cell or one of the two wings is ${x.z}. Cells that see all three can't be ${x.z}.`;
      case 'w-wing': return `The two ${ds} cells can't both be ${x.digits.find((v) => v !== x.z)}: the linked pair holds that digit and each of them sees one end. So one is ${x.z}, and cells seeing both lose ${x.z}.`;
      case 'ur': return `If the fourth cell were also ${ds}, the four cells could swap ${x.digits[0]} and ${x.digits[1]} and the puzzle would have two solutions. So it's neither.`;
      case 'x-chain': return `Along the chain, links alternate between "only two places" and "see each other". Either end holds the ${d}, so cells that see both ends can't.`;
      case 'xy-chain': return `Each cell has two notes and passes the other one on along the chain. The first or the last cell is ${d}, so cells that see both can't be ${d}.`;
      case 'forcing': return `If this cell were ${d}, the singles shown in grey would follow${x.deep ? ' (with pairs and pointing along the way)' : ''}, and then ${conflictText(x)}. So it can't be ${d}.`;
      default: return x.deps && x.deps.length ? 'Where it applies, and the earlier hints (red) it needs.' : 'Where it applies, shaded.';
    }
  }
  // where to look (level 1): cells to tint, chip text, card text
  function hintLook(x) {
    const d = x.digits[0];
    if (x.kind === 'coloring') return { cells: x.cells, chip: `follow the ${d}s`, text: `Follow the <b>${d}s</b>: in several rows, columns and boxes they have only two places.` };
    if (['x-wing', 'swordfish', 'jellyfish', 'x-chain'].includes(x.kind))
      return { cells: x.cells, chip: `follow the ${d}s`, text: `Follow the <b>${d}s</b>: where can they still go?` };
    if (x.kind === 'forcing') return { cells: [x.cells[0]], chip: 'try a note here', text: 'Try each note of this cell: one of them leads to a contradiction.' };
    if (['xy-wing', 'xyz-wing', 'w-wing', 'ur', 'xy-chain'].includes(x.kind))
      return { cells: x.cells, chip: 'look at these cells', text: 'Look at these cells with only two or three notes.' };
    const u = unitOf(x.units[0].split(' → ')[0]);
    return { cells: u.cells, chip: `look in ${u.name}`, text: `Something to find in <b>${u.name}</b>.`, unit: u };
  }

  // ---------------------------------------------------------------- assist mode
  // Every hint available now, easiest first: singles (only place in a box,
  // in a row/column, only digit in a cell), then pointing and pairs, then
  // triples; a chained hint (step n) comes after all step n-1 hints.
  const ASSIST_RANK = { 'hidden-box': 0, 'hidden-line': 1, naked: 2, pointing: 3, pair: 4, triple: 5, 'hidden pair': 6, 'hidden triple': 7, coloring: 8,
    quad: 9, 'hidden quad': 10, 'x-wing': 11, swordfish: 12, jellyfish: 13, 'xy-wing': 14, 'xyz-wing': 15, 'w-wing': 16, ur: 17, 'x-chain': 18, 'xy-chain': 19, forcing: 20 };
  // A pair / triple the player has already noted: its cells' notes hold only
  // its digits (all of them between the cells), and no note it would erase is
  // left elsewhere. Nothing to do there, so assist skips it.
  function alreadyNoted(g, st) {
    const seen = new Set();
    for (const i of g.cells) {
      const n = st.notes[i];
      if (!n.size || [...n].some((d) => !g.digits.includes(d))) return false;
      n.forEach((d) => seen.add(d));
    }
    if (seen.size !== g.digits.length) return false;
    return [...g.elims].every(([j, ds]) => ds.every((d) => !st.notes[j].has(d)));
  }
  function assistList(a, st) {
    const items = [];
    a.singles.forEach((sg, k) => {
      const kind = sg.kind === 'naked' ? 'naked' : /^box/.test(sg.unit) ? 'hidden-box' : 'hidden-line';
      items.push({ cat: 'single', k, key: `s${sg.i}:${sg.d}`, rank: (sg.step - 1) * 100 + ASSIST_RANK[kind], pos: sg.i, item: sg });
    });
    for (const cat of GROUP_CATS) {
      a[cat].forEach((g, k) => {
        if (cat === 'subsets' && alreadyNoted(g, st)) return;
        items.push({ cat, k, key: `${g.kind}:${g.cells.join(',')}:${g.digits.join('')}`, rank: (g.step - 1) * 100 + ASSIST_RANK[g.kind] + (g.length || 0) / 100, pos: g.cells[0], item: g });
      });
    }
    return items.sort((p, q) => p.rank - q.rank || p.pos - q.pos);
  }
  // where to look (level 1): the unit the hint lives in
  function assistUnit(it) {
    if (it.cat === 'single') return it.item.kind === 'naked' ? unitsOfCell(it.item.i)[2] : unitOf(it.item.unit);
    return hintLook(it.item).unit || null;
  }
  const assistWhat = (it) => {
    const x = it.item;
    if (it.cat === 'single') return x.kind === 'naked' ? `only ${x.d} fits here` : `only place for ${x.d} in ${x.unit}`;
    return hintWhat(x);
  };
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
  const unitOf = (name) => UNITS.find((u) => u.name === name);
  // The digits of hint g that are actually possible in cell i when the hint applies.
  // A triple 3·4·7 means its cells hold 3, 4 and 7 between them, not that each
  // cell can take all three (one of them may see a placed 4, for instance).
  function hintDigitsIn(g, i, a) {
    if (g.cellDigits) return g.cellDigits.get(i) || [];
    return g.digits.filter((d) => {
      if (!a.cand[i] || !a.cand[i].has(d)) return false;
      const by = a.removedBy.get(i + ':' + d);
      return by == null || a.hints[by].round >= g.round;   // not erased in an earlier pass
    });
  }
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
        <button data-act="finish" class="sdkh-finish-btn" title="Type the solution into every empty cell (click twice to confirm)">🏁 Finish grid</button>
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
  let gradeKey = '', gradeTimer = 0;
  function showGrade(g) {
    gradeEl.hidden = g == null;
    if (g == null) return;
    gradeEl.textContent = `${g}/10`;
    gradeEl.dataset.g = g;
    gradeEl.style.setProperty('--h', String(Math.round(130 - (g - 1) * 13)));   // green → red
    gradeEl.title = g === 0 ? 'Grid solved: 0/10'
      : `Difficulty of what's left: ${g}/10 — the hardest step needed is ${GRADE_NAMES[g]}. It goes down as you fill the grid.`;
  }
  function updateGrade(st) {
    if (!st || st.error || pageInfo().type === 'killer') { gradeKey = ''; showGrade(null); return; }   // killer: cages aren't used
    const key = st.grid.join('');
    if (key === gradeKey) return;
    gradeKey = key;
    if (gradeCache.has(key)) { showGrade(gradeCache.get(key)); return; }
    clearTimeout(gradeTimer);
    gradeTimer = setTimeout(() => {
      const g = gradeGrid(st.grid);
      if (gradeCache.size > 200) gradeCache.clear();
      gradeCache.set(key, g);
      if (gradeKey === key) showGrade(g);
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

  const KIND_LABEL = { pair: 'Pair', triple: 'Triple', 'hidden pair': 'Hidden pair', 'hidden triple': 'Hidden triple', pointing: 'Pointing', coloring: 'Chain',
    quad: 'Quad', 'hidden quad': 'Hidden quad', 'x-wing': 'X-wing', swordfish: 'Swordfish', jellyfish: 'Jellyfish', 'xy-wing': 'XY-wing',
    'xyz-wing': 'XYZ-wing', 'w-wing': 'W-wing', ur: 'Unique rectangle', 'x-chain': 'X-chain', 'xy-chain': 'XY-chain', forcing: 'Forcing chain' };
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
