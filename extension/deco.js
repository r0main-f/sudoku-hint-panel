// Sudoku Hint Panel — what to draw on the grid for a hint or a single, as plain
// data (no page code): which cells to shade or frame, which notes to colour or
// strike, which digits to ring, which links to draw. The "any grid" page and the
// panel on other sudoku sites paint this data their own way.
//   const Dz = createDecorator(engine, explainer, symbolFn)
//   const D = Dz.blank(); Dz.hint(D, hint, level, a, grid); Dz.single(D, single, level, a, st)
(function (root) {
  'use strict';
  function createDecorator(E, X, sym = String) {
    const { NN, N } = E;
    const PALETTE = ['#1565c0', '#8e24aa', '#ef6c00', '#00838f', '#6d4c41', '#37474f'];   // no green (singles) and no red (erase)
    const CHAIN_COLORS = ['#1565c0', '#ef6c00'], STEP_GREY = '#8a93a8', RED = '#c62828';

    // one colour per hint, chains in their own blue
    function colour(a) {
      let k = 0;
      for (const c of E.GROUP_CATS) a[c].forEach((g) => { g.color = g.colorOf ? CHAIN_COLORS[0] : PALETTE[k++ % PALETTE.length]; });
    }
    function blank() {
      return { cls: Array.from({ length: NN }, () => new Set()), show: Array.from({ length: NN }, () => new Set()),
        note: Array.from({ length: NN }, () => new Map()), ghost: Array(NN).fill(0), frames: Array.from({ length: NN }, () => []),
        marks: Array.from({ length: NN }, () => []), links: [] };
    }
    const showDigits = (D, grid, i, ds) => { if (!grid[i]) ds.forEach((d) => D.show[i].add(d)); };

    // a hint: level 1 just frames it softly, 3 adds where it applies and the earlier hints it needs
    function hint(D, g, level, a, grid) {
      const forcing = g.kind === 'forcing';
      if (level >= 3) {
        for (const n of X.shadeOf(g)) { const u = X.unitOf(n); if (u) u.cells.forEach((j) => { if (!g.cells.includes(j)) D.cls[j].add('unit'); }); }
        for (const h of g.deps || []) for (const i of a.hints[h].cells) {
          if (g.cells.includes(i)) continue;
          D.frames[i].push({ dep: true });
          const ds = X.hintDigitsIn(a.hints[h], i, a); showDigits(D, grid, i, ds); ds.forEach((d) => D.note[i].set(d, ['hd', RED]));
        }
      }
      g.cells.forEach((i, n) => {
        const col = g.colorOf ? CHAIN_COLORS[g.colorOf.get(i)] : forcing && n > 0 ? STEP_GREY : g.color || PALETTE[0];
        D.frames[i].push({ c: col });
        const ds = X.hintDigitsIn(g, i, a);
        showDigits(D, grid, i, ds);
        ds.forEach((d) => D.note[i].set(d, ['hd', col]));
      });
      for (const [j, ds] of g.elims) { showDigits(D, grid, j, ds); ds.forEach((d) => D.note[j].set(d, ['el'])); }
      if (forcing && g.conflict != null) { D.frames[g.conflict].push({ conflict: true }); D.cls[g.conflict].add('dead'); }
      for (const [p, q, ld] of g.links || []) D.links.push([p, q, ld || g.digits[0]]);
    }

    // a single: level 2 shades where to look, 3 shows why (rings on the blocking digits, × on ruled-out cells)
    function single(D, sg, level, a, st) {
      const grid = st.grid;
      D.cls[sg.i].add('single'); D.ghost[sg.i] = sg.d;
      const units = sg.kind === 'naked' ? X.unitsOfCell(sg.i) : [X.unitOf(sg.unit)];
      units.forEach((u) => u.cells.forEach((j) => { if (j !== sg.i) D.cls[j].add('unit'); }));
      if (level < 3) return;
      const blocker = (name, d) => X.unitOf(name).cells.find((j) => grid[j] === d);
      const used = new Set();
      if (sg.kind === 'naked') {
        for (let d = 1; d <= N; d++) {
          if (d === sg.d) continue;
          const w = X.whyNot(sg.i, d, st, a);
          if (/^(row|column|box) /.test(w.key)) { const b = blocker(w.key, d); if (b != null) D.marks[b].push('ring'); }
          else if (w.key.startsWith('h')) used.add(+w.key.slice(1));
        }
      } else {
        const u = X.unitOf(sg.unit);
        for (const j of u.cells) {
          if (j === sg.i || grid[j]) continue;
          const w = X.whyNot(j, sg.d, st, a, u.name);
          if (/^(row|column|box) /.test(w.key)) { const b = blocker(w.key, sg.d); if (b != null) D.marks[b].push('ring'); D.marks[j].push('no'); }
          else if (w.key.startsWith('h')) { D.marks[j].push('nohint'); used.add(+w.key.slice(1)); }
          else D.marks[j].push('no');
        }
      }
      for (const h of used) for (const i of a.hints[h].cells) {
        D.frames[i].push({ dep: true });
        const ds = X.hintDigitsIn(a.hints[h], i, a); showDigits(D, grid, i, ds); ds.forEach((d) => D.note[i].set(d, ['hd', RED]));
      }
    }
    const singleWhy = (sg) => (sg.kind === 'naked'
      ? `Every other digit is already in this cell’s row, column or box (blue circles)${sg.deps.length ? ', or was erased by an earlier hint (red)' : ''}, so only ${sym(sg.d)} fits.`
      : `Every other empty cell of ${sg.unit} is ruled out (×): its row, column or box already has this digit (blue circles)${sg.deps.length ? ', or an earlier hint erased it (red)' : ''}. So the ${sym(sg.d)} goes here.`);

    return { PALETTE, CHAIN_COLORS, colour, blank, hint, single, singleWhy };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createDecorator };
  else root.createDecorator = createDecorator;
})(typeof globalThis !== 'undefined' ? globalThis : this);
