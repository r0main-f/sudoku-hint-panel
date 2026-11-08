// Sudoku Hint Panel — the solver page's background thread: runs the engine so
// the page stays responsive on big grids (a 16×16 analysis can take a second).
importScripts('engine.js');

const engines = new Map();
const engineFor = (br, bc) => {
  const k = br + 'x' + bc;
  if (!engines.has(k)) engines.set(k, createSudokuEngine(br, bc));
  return engines.get(k);
};

// How many solutions (0, 1, or 2 meaning "several"), with a work budget.
function countSolutions(E, grid0) {
  const { NN, N, PEERS } = E, g = grid0.slice();
  let n = 0, budget = 300000;
  const go = () => {
    if (--budget < 0) return;
    let best = -1, bc = null;
    for (let i = 0; i < NN; i++) {
      if (g[i]) continue;
      const c = [];
      for (let d = 1; d <= N; d++) if (!PEERS[i].some((p) => g[p] === d)) c.push(d);
      if (!c.length) return;
      if (!bc || c.length < bc.length) { best = i; bc = c; if (c.length === 1) break; }
    }
    if (best < 0) { n++; return; }
    for (const d of bc) { g[best] = d; go(); if (n >= 2 || budget < 0) break; }
    g[best] = 0;
  };
  go();
  return budget < 0 && n < 2 ? (n ? 1 : -1) : n;   // -1: gave up before finding any
}

self.onmessage = (e) => {
  const { id, br, bc, grid, notes, want } = e.data;
  const E = engineFor(br, bc), st = { grid, notes: notes.map((x) => new Set(x)) }, out = { id };
  try {
    // a digit twice in a row, column or box: nothing else makes sense
    const clash = new Set();
    for (const u of E.UNITS) {
      const seen = new Map();
      for (const i of u.cells) if (grid[i]) {
        if (seen.has(grid[i])) { clash.add(i); clash.add(seen.get(grid[i])); }
        else seen.set(grid[i], i);
      }
    }
    out.clash = [...clash];
    if (clash.size) { out.solutions = 0; postMessage(out); return; }
    if (want.includes('count')) out.solutions = countSolutions(E, grid);
    if (out.solutions !== 0) {
      out.solution = E.solveGrid(grid);
      if (want.includes('analyse')) out.a = E.analyse(st);
      if (want.includes('optimized')) out.optimized = E.analyse({ grid, notes: grid.map(() => new Set()) }, E.MAIN_TIERS).reduced;
      if (want.includes('grade')) out.grade = E.gradeGrid(grid);
      if (want.includes('path')) out.path = E.solvePath(grid);
    }
  } catch (err) { out.error = String(err && err.message || err); }
  postMessage(out);
};
