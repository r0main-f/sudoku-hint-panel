// The engine on every grid size: its units and peers, then generated puzzles
// (unique solution) solved like a player — every hint must agree with the
// solution, every grid must be finished, and Finish grid's order must be valid.
//   node tests/sizes.js
const { createSudokuEngine } = require('../extension/engine.js');
let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function check(BR, BC, count, holesFrac) {
  const E = createSudokuEngine(BR, BC), { N, NN, UNITS, PEERS } = E;
  // structure
  if (UNITS.length !== 3 * N) throw 'units';
  for (const u of UNITS) if (new Set(u.cells).size !== N || u.cells.some((i) => i < 0 || i >= NN)) throw 'unit ' + u.name;
  for (let i = 0; i < NN; i++) { if (UNITS.filter((u) => u.cells.includes(i)).length !== 3) throw 'cell units'; if (PEERS[i].length !== 2 * (N - 1) + (N - BR - BC + 1)) throw 'peers ' + PEERS[i].length; }
  // a random solution, then holes while the solution stays unique
  const countSol = (g, limit, budget = { n: N > 9 ? 400000 : 200000 }) => { let n = 0; const go = () => { if (--budget.n < 0) return; let best = -1, bc = null;
    for (let i = 0; i < NN; i++) if (!g[i]) { const c = []; for (let d = 1; d <= N; d++) if (!PEERS[i].some((p) => g[p] === d)) c.push(d); if (!c.length) return; if (!bc || c.length < bc.length) { best = i; bc = c; if (c.length === 1) break; } }
    if (best < 0) { n++; return; } for (const d of bc) { g[best] = d; go(); if (n >= limit || budget.n < 0) break; } g[best] = 0; }; go(); return budget.n < 0 ? 99 : n; };
  const stats = { puzzles: 0, holes: 0, bad: 0, solvedLikePlayer: 0, pathOk: 0, given: 0, maxAnalyseMs: 0, maxPathMs: 0, grades: {}, kinds: {} };
  for (let t = 0; t < count; t++) {
    const sol = Array(NN).fill(0);
    const fill = (i) => { if (i === NN) return true; for (const d of shuffle([...E.DIGITS])) if (!PEERS[i].some((p) => sol[p] === d)) { sol[i] = d; if (fill(i + 1)) return true; } sol[i] = 0; return false; };
    if (!fill(0)) throw 'no solution';
    const puz = sol.slice(); let holes = 0;
    for (const i of shuffle([...Array(NN).keys()])) { if (holes >= NN * holesFrac) break; const v = puz[i]; puz[i] = 0; if (countSol(puz.slice(), 2) !== 1) puz[i] = v; else holes++; }
    stats.puzzles++; stats.holes += holes;
    const s2 = E.solveGrid(puz); if (!s2 || s2.join() !== sol.join()) { stats.bad++; console.log('solveGrid wrong'); }
    // like a player: place the singles, or erase the notes the hints point to
    const g = puz.slice(); let notes = g.map(() => new Set()), stuck = false;
    for (let it = 0; g.includes(0) && it < NN * 4; it++) {
      const t0 = Date.now(); const a = E.analyse({ grid: g, notes }); stats.maxAnalyseMs = Math.max(stats.maxAnalyseMs, Date.now() - t0);
      for (const h of a.hints) { stats.kinds[h.kind] = (stats.kinds[h.kind] || 0) + 1; for (const [j, ds] of h.elims) for (const d of ds) if (sol[j] === d) { stats.bad++; console.log('BAD elim', h.kind); } }
      for (const s of a.singles) if (sol[s.i] !== s.d) { stats.bad++; console.log('BAD single'); }
      if (a.singles.length) { for (const s of a.singles) g[s.i] = s.d; notes = notes.map((n, i) => (g[i] ? new Set() : n)); if (notes.some((n) => n.size)) notes = a.reduced.map((c, i) => (g[i] ? new Set() : new Set([...(c || [])].filter((d) => !E.PEERS[i].some((p) => g[p] === d))))); continue; }
      if (!a.hints.length) { stuck = true; break; }
      notes = a.reduced.map((c) => new Set(c || []));
    }
    if (!stuck && !g.includes(0)) stats.solvedLikePlayer++;
    const t1 = Date.now(); const p = E.solvePath(puz); stats.maxPathMs = Math.max(stats.maxPathMs, Date.now() - t1);
    const placed = new Map(p.steps.map((s) => [s.i, s.d]));
    if (p.steps.every((s) => sol[s.i] === s.d && !puz[s.i]) && placed.size === puz.filter((v) => !v).length) stats.pathOk++; else { stats.bad++; console.log('BAD path'); }
    stats.given += p.unreached;
    const gr = E.gradeGrid(puz); stats.grades[gr.score] = (stats.grades[gr.score] || 0) + 1;
  }
  stats.holes = (stats.holes / stats.puzzles).toFixed(0) + ' of ' + NN;
  const ok = !stats.bad && stats.solvedLikePlayer === stats.puzzles && stats.pathOk === stats.puzzles;
  console.log(`${ok ? '✓' : '✗'} ${N}×${N} (boxes ${BR}×${BC}): ${stats.puzzles} puzzles, ${stats.holes} cells empty, all solved: ${stats.solvedLikePlayer === stats.puzzles}, wrong hints: ${stats.bad}, slowest analysis ${stats.maxAnalyseMs} ms`);
  if (!ok) { console.log(JSON.stringify(stats)); process.exitCode = 1; }
}
check(2, 2, 40, 0.75);   // 4×4
check(2, 3, 30, 0.7);    // 6×6, boxes 2 rows × 3 columns
check(3, 2, 10, 0.7);    // 6×6, boxes 3 rows × 2 columns
check(3, 3, 15, 0.7);    // 9×9
check(3, 4, 4, 0.6);     // 12×12
check(4, 4, 4, 0.55);    // 16×16
