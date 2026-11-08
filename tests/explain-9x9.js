// Continuity check for the texts and the assist order (explain.js) on the
// same ~800 boards as golden-9x9.js: every hint's "where / what / why" text,
// labels and the assist order are fingerprinted and compared with
// fixtures/explain-9x9.golden.json.
//   node tests/explain-9x9.js            check
//   node tests/explain-9x9.js --update   record (only after an intended change)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createSudokuEngine } = require('../extension/engine.js');
const { createExplainer } = require('../extension/explain.js');
const { boards } = require('./golden-9x9.js');
const E = createSudokuEngine(3, 3), X = createExplainer(E);
const realNow = Date.now; Date.now = () => 0;
const got = {};
for (const [label, grid, notes] of boards(E)) {
  const st = { grid, notes };
  if (!E.solveGrid(grid)) continue;
  const a = E.analyseFresh(st, E.TIERS.length);
  const out = X.assistList(a, st).map((it) => {
    const x = it.item, r = [it.key, it.rank, X.assistWhat(it), X.assistUnit(it) && X.assistUnit(it).name];
    if (it.cat === 'single') r.push(...E.DIGITS.map((d) => X.whyNot(x.i, d, st, a).text), X.unitsOfCell(x.i).map((u) => u.name));
    else r.push(X.hintWhat(x), X.hintWhy(x), JSON.stringify(X.hintLook(x)), X.shadeOf(x), X.hintLabel(x), x.cells.map((i) => X.hintDigitsIn(x, i, a)), X.alreadyNoted(x, st));
    return r;
  });
  got[label] = crypto.createHash('sha1').update(JSON.stringify(out)).digest('hex');
}
Date.now = realNow;
const file = path.join(__dirname, 'fixtures', 'explain-9x9.golden.json');
if (process.argv.includes('--update')) { fs.writeFileSync(file, JSON.stringify(got).replace(/","/g, '",\n"') + '\n'); console.log(`recorded ${Object.keys(got).length} fingerprints`); }
else {
  const want = JSON.parse(fs.readFileSync(file));
  const diff = Object.keys(want).filter((k) => want[k] !== got[k]).concat(Object.keys(got).filter((k) => !(k in want)));
  if (diff.length) { console.error(`✗ hint texts or assist order changed on ${diff.length} boards: ${diff.slice(0, 10).join(', ')}…`); process.exit(1); }
  console.log(`✓ hint texts and assist order unchanged on all ${Object.keys(got).length} boards`);
}
