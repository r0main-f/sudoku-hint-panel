// Continuity check for the classic 9×9 engine: every analysis the panel can
// show (hints, singles, steps, notes checks, grade, Finish grid order, each
// technique's finder) is fingerprinted on ~800 boards and compared with
// fixtures/engine-9x9.golden.json, recorded from the engine before it was
// split out of content.js. Any change in behaviour shows up as a mismatch.
//   node tests/golden-9x9.js            check
//   node tests/golden-9x9.js --update   record new fingerprints (only after an intended change)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const FIX = path.join(__dirname, 'fixtures');

function boards(E) {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const empty = (g) => g.map(() => new Set());
  const out = [];
  const lv = JSON.parse(fs.readFileSync(path.join(FIX, 'sudoku-com-levels.json')));
  for (const [name, list] of Object.entries(lv)) list.forEach((s, n) => {
    const g = [...s].map(Number), sol = E.solveGrid(g.slice()).slice();
    out.push([`${name}${n}`, g, empty(g)]);
    for (const frac of [0.25, 0.5, 0.8]) {   // partly filled, as during a game
      const p = g.slice(); p.forEach((v, i) => { if (!v && rnd() < frac) p[i] = sol[i]; });
      out.push([`${name}${n}@${frac}`, p, empty(p)]);
    }
    const notes = E.candidates(g).map((x) => new Set(x || []));   // full notes, then one erased by mistake
    out.push([`${name}${n}+notes`, g, notes]);
    const k = notes.findIndex((x) => x.size > 2), bad = notes.map((x) => new Set(x)); bad[k].delete(sol[k]);
    out.push([`${name}${n}+badnote`, g, bad]);
  });
  const played = JSON.parse(fs.readFileSync(path.join(FIX, 'played-states.json')));   // real games, with their notes
  for (const [name, o] of Object.entries(played)) {
    out.push([name, o.grid, o.notes.map((x) => new Set(x))]);
    out.push([name + '-nonotes', o.grid, empty(o.grid)]);
  }
  for (const [nm, s] of [['hardest', '800000000003600000070090200050007000000045700000100030001000068008500010090000400'],
    ['golden-nugget', '000000039000001005003050800008090006070002000100400000009080050020000600400700000'],
    ['wrongdigit', '110000000000000000000000000000000000000000000000000000000000000000000000000000000']]) {
    const g = [...s].map(Number); out.push([nm, g, empty(g)]);
  }
  return out;
}

const ser = (x) => JSON.stringify(x, (k, v) => (v instanceof Map ? { M: [...v] } : v instanceof Set ? { S: [...v] } : v));
function fingerprint(E, [label, grid, notes]) {
  const st = { grid, notes }, cand = E.candidates(grid);
  const rec = {
    label, sol: E.solveGrid(grid), full: E.analyseFresh(st, E.TIERS.length), main: E.analyseFresh(st, E.MAIN_TIERS),
    grade: E.gradeGrid(grid), path: E.solvePath(grid), notesCheck: E.notesCheck(st), anySingle: E.anySingle(cand, grid),
    finders: grid.includes(0) && E.solveGrid(grid) ? [E.findSubsets(cand), E.findHidden(cand), E.findPointing(cand), E.findColoring(cand),
      E.findQuads(cand), E.findFish(cand, [2, 3, 4]), E.findWings(cand), E.findRectangles(cand), E.findChains(cand)] : null,
  };
  return crypto.createHash('sha1').update(ser(rec)).digest('hex');
}

function run(E, { update = false } = {}) {
  const realNow = Date.now; Date.now = () => 0;   // freeze the forcing-chain time budgets: same result on any machine
  try {
    const got = {}; for (const b of boards(E)) got[b[0]] = fingerprint(E, b);
    const file = path.join(FIX, 'engine-9x9.golden.json');
    if (update) { fs.writeFileSync(file, JSON.stringify(got, null, 0).replace(/","/g, '",\n"') + '\n'); return { boards: Object.keys(got).length, updated: true }; }
    const want = JSON.parse(fs.readFileSync(file));
    const diff = Object.keys(want).filter((k) => want[k] !== got[k]).concat(Object.keys(got).filter((k) => !(k in want)));
    return { boards: Object.keys(got).length, diff };
  } finally { Date.now = realNow; }
}
module.exports = { boards, fingerprint, run };

if (require.main === module) {
  const { createSudokuEngine } = require('../extension/engine.js');
  const r = run(createSudokuEngine(3, 3), { update: process.argv.includes('--update') });
  if (r.updated) console.log(`recorded ${r.boards} fingerprints`);
  else if (r.diff.length) { console.error(`✗ 9×9 engine changed on ${r.diff.length} of ${r.boards} boards: ${r.diff.slice(0, 10).join(', ')}…`); process.exit(1); }
  else console.log(`✓ 9×9 engine unchanged on all ${r.boards} boards`);
}
