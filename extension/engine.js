// Sudoku Hint Panel — the solving engine, for a grid of any box size:
// createSudokuEngine(3, 3) is the classic 9×9, (2, 3) a 6×6 with 2×3 boxes,
// (2, 2) a 4×4, (4, 4) a 16×16. Pure logic: no page, no DOM — the same code runs
// in the extension and in the tests (Node).
(function (root) {
  'use strict';
  function createSudokuEngine(BR = 3, BC = 3) {
    const N = BR * BC, NN = N * N;
    const DIGITS = Array.from({ length: N }, (_, k) => k + 1);
    const ALL = Array.from({ length: NN }, (_, k) => k);   // every cell, in reading order
    const num = (a, b) => a - b;
    const GUARD = Math.max(400, NN * 3);   // loop guards: 400 on the classic grid
    // ---------------------------------------------------------------- units & peers
    const range9 = [...Array(N).keys()];   // 0 … N-1 (named for the classic grid)
    const UNITS = [
      ...range9.map((r) => ({ name: `row ${r + 1}`, cells: range9.map((c) => r * N + c) })),
      ...range9.map((c) => ({ name: `column ${c + 1}`, cells: range9.map((r) => r * N + c) })),
      ...range9.map((b) => {
        const br = Math.floor(b / BR) * BR, bc = (b % BR) * BC;   // a box is BR rows × BC columns
        return { name: `box ${b + 1}`, cells: range9.map((k) => (br + Math.floor(k / BC)) * N + bc + (k % BC)) };
      }),
    ];
    const PEERS = Array.from({ length: NN }, (_, i) => {
      const s = new Set();
      for (const u of UNITS) if (u.cells.includes(i)) u.cells.forEach((j) => s.add(j));
      s.delete(i);
      return [...s];
    });
    const cellName = (i) => `r${Math.floor(i / N) + 1}c${(i % N) + 1}`;
    // hint kind -> panel category, categories from simplest to hardest
    const CAT_OF = { pointing: 'pointing', pair: 'subsets', triple: 'subsets', 'hidden pair': 'subsets', 'hidden triple': 'subsets',
      coloring: 'coloring', quad: 'quads', 'hidden quad': 'quads', 'x-wing': 'fish', swordfish: 'fish', jellyfish: 'fish',
      'xy-wing': 'wings', 'xyz-wing': 'wings', 'w-wing': 'wings', ur: 'ur', 'x-chain': 'chains', 'xy-chain': 'chains', forcing: 'forcing' };
    const GROUP_CATS = ['pointing', 'subsets', 'coloring', 'quads', 'fish', 'wings', 'ur', 'chains', 'forcing'];


    function candidates(grid) {
      return grid.map((v, i) => {
        if (v) return null;
        const s = new Set(DIGITS);
        for (const p of PEERS[i]) s.delete(grid[p]);
        return s;
      });
    }

    // The player's notes count only once every empty cell has notes (e.g. after
    // "Fill all candidates"). Then each erased note narrows the candidates, so the
    // next single / pair / pointing cell appears. Partial notes are ignored.
    function notesComplete(st) {
      let empty = 0;
      for (let i = 0; i < NN; i++) if (!st.grid[i]) { empty++; if (!st.notes[i].size) return false; }
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
      let budget = N > 9 ? 2000000 : 200000;
      const go = () => {
        if (--budget < 0) return false;
        let best = -1, bestC = null;
        for (let i = 0; i < NN; i++) {
          if (g[i]) continue;
          const c = [];
          for (let d = 1; d <= N; d++) if (!PEERS[i].some((p) => g[p] === d)) c.push(d);
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
      for (let i = 0; i < NN; i++) if (!st.grid[i] && !st.notes[i].has(sol[i])) bad.push(i);
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
            g = { kind, cells: cs, digits: [...union].sort(num), units: [], elims: new Map() };
            byKey.set(key, g);
          }
          g.units.push(u.name);
          for (const j of u.cells) {
            if (cs.includes(j) || !cand[j]) continue;
            const ds = g.digits.filter((d) => cand[j].has(d));
            if (ds.length) g.elims.set(j, [...new Set([...(g.elims.get(j) || []), ...ds])].sort(num));
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
        for (let d = 1; d <= N; d++) {
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
              const rest = [...cand[i]].filter((d) => !digits.includes(d)).sort(num);
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
      for (let b = 0; b < N; b++) {
        const box = UNITS[2 * N + b];
        for (let d = 1; d <= N; d++) {
          const cs = box.cells.filter((i) => cand[i] && cand[i].has(d));
          if (cs.length < 2) continue; // 1 cell = a hidden single, not pointing
          for (const [base, lineOf] of [[0, (i) => Math.floor(i / N)], [N, (i) => i % N]]) {
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
      for (let l = 0; l < 2 * N; l++) {
        const line = UNITS[l];
        for (let d = 1; d <= N; d++) {
          const cs = line.cells.filter((i) => cand[i] && cand[i].has(d));
          if (cs.length < 2) continue;
          const b = boxOf(cs[0]);
          if (!cs.every((i) => boxOf(i) === b)) continue;
          const box = UNITS[2 * N + b];
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
    function boxOf(i) { return Math.floor(Math.floor(i / N) / BR) * BR + Math.floor((i % N) / BC); }

    // Chains on one digit ("coloring"). Where a row, column or box has only two
    // places for d, exactly one of them is d: link them. Following the links,
    // the cells alternate between two colours, and one colour holds all the d's.
    //  - wrap: two cells of the same colour share a unit → that colour is wrong,
    //    d is erased from all its cells;
    //  - trap: a cell outside the chain sees both colours → d is erased there.
    function findColoring(cand) {
      const out = [];
      for (let d = 1; d <= N; d++) {
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
          for (let i = 0; i < NN; i++) {
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
    const ROWS = UNITS.slice(0, N), COLS = UNITS.slice(N, 2 * N);
    const sees = (i, j) => i !== j && PEERS[i].includes(j);
    const has = (cand, i, d) => !!(cand[i] && cand[i].has(d));
    function combos(arr, n, start = 0, acc = [], out = []) {
      if (acc.length === n) { out.push(acc.slice()); return out; }
      for (let k = start; k < arr.length; k++) { acc.push(arr[k]); combos(arr, n, k + 1, acc, out); acc.pop(); }
      return out;
    }
    const addElim = (elims, j, d) => { const l = elims.get(j) || []; if (!l.includes(d)) l.push(d); elims.set(j, l.sort(num)); };

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
          if (elims.size && !keys.has(key)) { keys.add(key); out.push({ kind: 'quad', cells: cs, digits: [...union].sort(num), units: [u.name], elims }); }
        }
        const where = {};
        for (let d = 1; d <= N; d++) { const cs = u.cells.filter((i) => has(cand, i, d)); if (cs.length >= 2 && cs.length <= 4) where[d] = cs; }
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
        for (let d = 1; d <= N; d++) {
          for (const [bases, covers] of [[ROWS, COLS], [COLS, ROWS]]) {
            const pos = bases.map((u) => u.cells.filter((i) => has(cand, i, d)));
            const lines = range9.filter((k) => pos[k].length >= 2 && pos[k].length <= n);
            for (const bs of combos(lines, n)) {
              const coverIdx = new Set();
              bs.forEach((k) => pos[k].forEach((i) => coverIdx.add(bases === ROWS ? i % N : Math.floor(i / N))));
              if (coverIdx.size !== n) continue;
              const baseCells = new Set(bs.flatMap((k) => bases[k].cells));
              const elims = new Map();
              coverIdx.forEach((c) => covers[c].cells.forEach((j) => { if (!baseCells.has(j) && has(cand, j, d)) addElim(elims, j, d); }));
              if (!elims.size) continue;
              out.push({ kind: FISH[n], cells: bs.flatMap((k) => pos[k]).sort((a, b) => a - b), digits: [d],
                units: [...bs.map((k) => bases[k].name), ...[...coverIdx].sort(num).map((c) => covers[c].name)], base: bs.map((k) => bases[k].name), elims });
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
      const bi = ALL.filter((i) => cand[i] && cand[i].size === 2);
      const tri = ALL.filter((i) => cand[i] && cand[i].size === 3);
      const push = (kind, cells, digits, z, targets) => {
        const elims = new Map();
        for (let j = 0; j < NN; j++) if (!cells.includes(j) && has(cand, j, z) && targets.every((t) => sees(j, t))) addElim(elims, j, z);
        const key = kind + cells.slice().sort((a, b) => a - b).join(',') + ':' + z;
        if (elims.size && !keys.has(key)) { keys.add(key); out.push({ kind, cells, digits, units: [], elims, z }); }
      };
      for (const p of bi) {
        const [x, y] = [...cand[p]];
        const wa = bi.filter((a) => sees(p, a) && cand[a].has(x) && !cand[a].has(y));
        const wb = bi.filter((b) => sees(p, b) && cand[b].has(y) && !cand[b].has(x));
        for (const a of wa) for (const b of wb) {
          const za = [...cand[a]].find((d) => d !== x), zb = [...cand[b]].find((d) => d !== y);
          if (za === zb) push('xy-wing', [p, a, b], [x, y, za].sort(num), za, [a, b]);
        }
      }
      for (const p of tri) {
        const ws = bi.filter((a) => sees(p, a) && [...cand[a]].every((d) => cand[p].has(d)));
        for (const [a, b] of combos(ws, 2)) {
          const common = [...cand[a]].filter((d) => cand[b].has(d));
          if (common.length !== 1 || new Set([...cand[a], ...cand[b]]).size !== 3) continue;
          push('xyz-wing', [p, a, b], [...cand[p]].sort(num), common[0], [p, a, b]);
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
              push('w-wing', [a, b, c1, c2], [x, y].sort(num), y, [a, b]);
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
        const cs = [r1 * N + c1, r1 * N + c2, r2 * N + c1, r2 * N + c2];
        const boxes = new Set(cs.map(boxOf));
        if (boxes.size !== 2 || !cs.every((i) => cand[i])) continue;
        const pairCells = cs.filter((i) => cand[i].size === 2);
        if (pairCells.length !== 3) continue;
        const pair = [...cand[pairCells[0]]].sort(num);
        if (!pairCells.every((i) => [...cand[i]].sort(num).join() === pair.join())) continue;
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
      for (let d = 1; d <= N; d++) {   // X-chains
        const strong = new Map();
        for (const u of UNITS) {
          const cs = u.cells.filter((i) => has(cand, i, d));
          if (cs.length !== 2) continue;
          for (const [p, q] of [cs, cs.slice().reverse()]) { if (!strong.has(p)) strong.set(p, new Set()); strong.get(p).add(q); }
        }
        const withD = ALL.filter((i) => has(cand, i, d));
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
      const bi = ALL.filter((i) => cand[i] && cand[i].size === 2);
      for (const s of bi) for (const a of cand[s]) {   // XY-chains: assume s isn't a
        const other = (i, d) => [...cand[i]].find((x) => x !== d);
        const start = other(s, a);
        const prev = new Map([[s + ':' + start, null]]), q = [[s, start, 1]];
        while (q.length) {
          const [c, t, len] = q.shift();   // t: the digit c must then be
          if (c !== s && t === a && len >= 3) {
            const elims = new Map();
            for (let j = 0; j < NN; j++) if (j !== s && j !== c && has(cand, j, a) && sees(j, s) && sees(j, c)) addElim(elims, j, a);
            const key = 'y' + a + ':' + Math.min(s, c) + ',' + Math.max(s, c);
            if (elims.size && !keys.has(key)) {
              keys.add(key);
              const states = []; let k = c + ':' + t;
              while (k) { states.push(k.split(':').map(Number)); k = prev.get(k); }
              states.reverse();
              const path = states.map(([cell]) => cell);
              const links = states.slice(1).map(([cell], n) => [states[n][0], cell, states[n][1]]);   // passes the digit the earlier cell holds
              out.push({ kind: 'xy-chain', cells: path, digits: [a], units: [], links, ends: [s, c], elims,
                colorOf: new Map(path.map((v, n) => [v, n % 2])), cellDigits: new Map(path.map((v) => [v, [...cand[v]].sort(num)])) });
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
        for (let i = 0; i < NN; i++) {
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
      for (let guard = 0; guard < GUARD; guard++) {
        for (let j = 0; j < NN; j++) if (cand[j] && cand[j].size === 0) return { steps, conflict: j };
        for (const u of UNITS) for (let x = 1; x <= N; x++) {
          if (u.cells.some((j) => val[j] === x || (cand[j] && cand[j].has(x)))) continue;
          return { steps, conflict: null, unit: u.name, cd: x };
        }
        let move = null;
        for (let j = 0; j < NN && !move; j++) if (cand[j] && cand[j].size === 1) move = [j, [...cand[j]][0]];
        for (let k = 0; k < UNITS.length && !move; k++) {
          const u = UNITS[k];
          for (let x = 1; x <= N && !move; x++) {
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
    // How hard is what's left, on sudoku.com's own scale? Solve from the placed
    // digits, always taking the easiest step available, and count the work:
    // each wave of singles is 1 (2 if only a row or column gives them away),
    // each wave of erasures 8 + how far the technique is beyond pointing.
    // The total is mapped to 1-10 with thresholds measured on ~130 sudoku.com
    // puzzles: 1-2 Easy · 3-4 Medium · 5-6 Hard · 7-8 Expert · 9-10 Extreme
    // (forcing chains, or a grid beyond what the panel knows, is 10).
    const TECH_NAMES = ['', 'only place for a digit in a box', 'only place in a row or column', 'only digit left in a cell',
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
    const GRADE_CUTS = [5, 9, 10, 12, 18, 24, 32, 41, 56];   // work needed for 2/10, 3/10 … 10/10
    const GRADE_LEVELS = ['Easy', 'Easy', 'Medium', 'Medium', 'Hard', 'Hard', 'Expert', 'Expert', 'Extreme', 'Extreme'];
    function gradeGrid(grid0) {
      if (!grid0.includes(0)) return { score: 0, tech: 0 };
      if (!solveGrid(grid0)) return null;   // a wrong digit on the board: no grade
      const grid = grid0.slice(), cand = candidates(grid);
      const put = (i, d) => { grid[i] = d; cand[i] = null; for (const p of PEERS[i]) if (cand[p]) cand[p].delete(d); };
      const hiddenIn = (units) => {
        const out = new Map();
        for (const u of units) for (let d = 1; d <= N; d++) {
          if (u.cells.some((j) => grid[j] === d)) continue;
          const w = u.cells.filter((j) => cand[j] && cand[j].has(d));
          if (w.length === 1 && !out.has(w[0])) out.set(w[0], d);
        }
        return out;
      };
      let tech = 0, work = 0;
      const done = (t) => ({ score: t >= 10 ? 10 : 1 + GRADE_CUTS.filter((c) => work >= c).length, tech: Math.max(tech, t) });
      for (let guard = 0; guard < GUARD && grid.includes(0); guard++) {
        if (cand.some((c) => c && c.size === 0)) return null;
        let found = hiddenIn(UNITS.slice(2 * N)), lvl = 1;
        if (!found.size) { found = hiddenIn(UNITS.slice(0, 2 * N)); lvl = 2; }
        if (!found.size) { found = new Map(); cand.forEach((c, i) => { if (c && c.size === 1) found.set(i, [...c][0]); }); lvl = 3; }
        if (found.size) {
          found.forEach((d, i) => { if (!grid[i]) put(i, d); });
          tech = Math.max(tech, lvl); work += lvl === 2 ? 2 : 1;
          continue;
        }
        let erased = false;
        for (const [level, find] of GRADE_STEPS) {
          for (const g of find(cand, grid)) for (const [j, ds] of g.elims) for (const d of ds) if (cand[j] && cand[j].has(d)) { cand[j].delete(d); erased = true; }
          if (erased) { tech = Math.max(tech, level); work += 8 + level - 4; break; }
        }
        if (!erased) return done(10);   // beyond the techniques the panel knows
      }
      return done(grid.includes(0) ? 10 : tech);
    }
    // The order a person could solve the rest in: always the easiest move first,
    // one digit at a time — the only place for a digit in a box, then in a row
    // or column, then the only digit left in a cell; when none is left, the
    // easiest technique that erases candidates (pointing, pairs, chains…) and
    // back to singles. Returns the digits in that order, each with the hardest
    // technique it needed. When nothing the panel knows applies, one digit comes
    // from the solution (in the cell where the fewest fit) and it carries on.
    function solvePath(grid0) {
      const sol = solveGrid(grid0);
      if (!sol) return null;
      const grid = grid0.slice(), cand = candidates(grid), steps = [];
      const put = (i, d) => { grid[i] = d; cand[i] = null; for (const p of PEERS[i]) if (cand[p]) cand[p].delete(d); };
      const hiddenIn = (units) => {
        for (const u of units) for (let d = 1; d <= N; d++) {
          if (u.cells.some((j) => grid[j] === d)) continue;
          const w = u.cells.filter((j) => cand[j] && cand[j].has(d));
          if (w.length === 1) return [w[0], d];
        }
        return null;
      };
      let need = 0, given = 0;   // hardest erasing technique used since the last digit; digits given from the solution
      for (let guard = 0; guard < GUARD + 200 && grid.includes(0); guard++) {
        let mv = hiddenIn(UNITS.slice(2 * N)), lvl = 1;
        if (!mv) { mv = hiddenIn(UNITS.slice(0, 2 * N)); lvl = 2; }
        if (!mv) { const i = cand.findIndex((c) => c && c.size === 1); if (i >= 0) { mv = [i, [...cand[i]][0]]; lvl = 3; } }
        if (mv) {
          if (mv[1] !== sol[mv[0]]) break;   // can't happen with a unique solution; stay safe
          put(mv[0], mv[1]); steps.push({ i: mv[0], d: mv[1], tech: Math.max(lvl, need) }); need = 0;
          continue;
        }
        let erased = false;
        for (const [level, find] of GRADE_STEPS) {
          for (const g of find(cand, grid)) for (const [j, ds] of g.elims) for (const d of ds) if (cand[j] && cand[j].has(d) && d !== sol[j]) { cand[j].delete(d); erased = true; }
          if (erased) { need = Math.max(need, level); break; }
        }
        if (!erased) {   // beyond the panel's techniques: give one digit (where the fewest fit), then carry on
          let i = -1;
          for (let j = 0; j < NN; j++) if (!grid[j] && (i < 0 || cand[j].size < cand[i].size)) i = j;
          put(i, sol[i]); steps.push({ i, d: sol[i], tech: 10 }); need = 0; given++;
        }
      }
      for (let i = 0; i < NN; i++) if (!grid[i]) { steps.push({ i, d: sol[i], tech: 10 }); given++; }
      return { steps, unreached: given };
    }

    function anySingle(cand, grid) {
      for (let i = 0; i < NN; i++) if (cand[i] && cand[i].size === 1) return true;
      for (const u of UNITS) for (let d = 1; d <= N; d++) {
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
            pairs = g.cells.flatMap((i) => DIGITS.map((d) => [i, d]));
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
      for (let i = 0; i < NN; i++) {
        if (st.grid[i]) continue;
        if (cand0[i].size === 0) { dead.push(i); continue; }
        if (cand[i].size === 1) {
          const d = [...cand[i]][0];
          const deps = depsOf(DIGITS.map((x) => [i, x]));
          offer({ i, d, kind: 'naked', unit: '', deps, step: stepOf(deps), cost: N - 1 });
        }
      }
      for (const u of UNITS) {
        for (let d = 1; d <= N; d++) {
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
    return { N, NN, BR, BC, DIGITS, ALL, CAT_OF, FISH, GRADE_CUTS, GRADE_LEVELS, GRADE_STEPS, GROUP_CATS, MAIN_TIERS, MAX_CHAIN, PEERS, ROWS, COLS, TECH_NAMES, TIERS, UNITS, addElim, analyse, analyseFresh, anySingle, boxOf, candidates, cellName, combos, effectiveCands, findChains, findColoring, findFish, findForcing, findHidden, findPointing, findQuads, findRectangles, findSubsets, findWings, gradeGrid, has, notesCheck, notesComplete, range9, sees, solveGrid, solvePath, tryDigit };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createSudokuEngine };
  else root.createSudokuEngine = createSudokuEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
