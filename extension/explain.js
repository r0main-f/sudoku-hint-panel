// Sudoku Hint Panel — what each hint says: names, "where to look / what /
// why" texts, the assist order. Plain text and data, no page code, for any
// grid size: createExplainer(engine) with an engine from engine.js.
(function (root) {
  'use strict';
  function createExplainer(E, opts = {}) {
    const { N, UNITS, GROUP_CATS, CAT_OF, boxOf } = E;
    const S = opts.symbol || String;   // how a digit is written (16×16: 1…9, A…G)
    const CHAIN_NAMES = ['blue', 'orange'];

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
    const conflictText = (x) => (x.conflictUnit ? `no place left for ${S(x.conflictDigit)} in ${x.conflictUnit}` : 'a cell would have no digit left');
    // what the hint says (chip and card, level 2)
    function hintWhat(x) {
      const d = S(x.digits[0]), ds = x.digits.map(S).join('·');
      switch (x.kind) {
        case 'pointing': { const [from, to] = x.units[0].split(' → '); return `pointing ${d}: ${from} → ${to}`; }
        case 'coloring': return x.rule === 'wrap' ? `chain on ${d}: ${CHAIN_NAMES[x.falseColor]} would put two ${d}s in ${x.wrapUnit}` : `chain on ${d}: these cells see both colours`;
        case 'x-wing': case 'swordfish': case 'jellyfish': return `${FISH_NAME[x.kind]} on ${d}: ${x.base.join(', ')}`;
        case 'xy-wing': case 'xyz-wing': return `${WING_NAME[x.kind]}: one of the wings is ${S(x.z)}`;
        case 'w-wing': return `W-wing ${ds}: one of the two is ${S(x.z)}`;
        case 'ur': return `unique rectangle ${ds}`;
        case 'x-chain': return `chain on ${d}: one of the two ends is ${d}`;
        case 'xy-chain': return `XY-chain: one of the two ends is ${d}`;
        case 'forcing': return `if this were ${d}: ${conflictText(x)}`;
        default: return `${x.kind} ${ds} in ${x.units.join(' + ')}`;
      }
    }
    // why it works (card, level 3)
    function hintWhy(x) {
      const d = S(x.digits[0]), ds = x.digits.map(S).join('·');
      switch (x.kind) {
        case 'coloring': return `Where a ${d} has only two places, one of them is the ${d}, so linked cells alternate colours and one colour holds all the ${d}s. `
          + (x.rule === 'wrap' ? `${cap(CHAIN_NAMES[x.falseColor])} would put two ${d}s in ${x.wrapUnit}, so its ${d}s go.` : `The red cells see both colours, so they can't be ${d}.`);
        case 'quad': return `These four cells hold the four digits ${ds} between them, so those digits go from the rest of the unit.`;
        case 'hidden quad': return `The digits ${ds} fit only in these four cells, so the cells' other notes go.`;
        case 'x-wing': case 'swordfish': case 'jellyfish': {
          const n = x.base.length, rows = /^row/.test(x.base[0]);
          return `In each of these ${n} ${rows ? 'rows' : 'columns'} the ${d} is in a framed cell, all within the same ${n} ${rows ? 'columns' : 'rows'}. Those ${rows ? 'columns' : 'rows'} get their ${d}s from here, so their other ${d}s go.`;
        }
        case 'xy-wing': return `The middle cell is one of its two digits; either way one of the two wings becomes ${S(x.z)}. Cells that see both wings can't be ${S(x.z)}.`;
        case 'xyz-wing': return `The middle cell or one of the two wings is ${S(x.z)}. Cells that see all three can't be ${S(x.z)}.`;
        case 'w-wing': return `The two ${ds} cells can't both be ${S(x.digits.find((v) => v !== x.z))}: the linked pair holds that digit and each of them sees one end. So one is ${S(x.z)}, and cells seeing both lose ${S(x.z)}.`;
        case 'ur': return `If the fourth cell were also ${ds}, the four cells could swap ${S(x.digits[0])} and ${S(x.digits[1])} and the puzzle would have two solutions. So it's neither.`;
        case 'x-chain': return `Along the chain, links alternate between "only two places" and "see each other". Either end holds the ${d}, so cells that see both ends can't.`;
        case 'xy-chain': return `Each cell has two notes and passes the other one on along the chain. The first or the last cell is ${d}, so cells that see both can't be ${d}.`;
        case 'forcing': return `If this cell were ${d}, the singles shown in grey would follow${x.deep ? ' (with pairs and pointing along the way)' : ''}, and then ${conflictText(x)}. So it can't be ${d}.`;
        default: return x.deps && x.deps.length ? 'Where it applies, and the earlier hints (red) it needs.' : 'Where it applies, shaded.';
      }
    }
    // where to look (level 1): cells to tint, chip text, card text
    function hintLook(x) {
      const d = S(x.digits[0]);
      if (x.kind === 'coloring') return { cells: x.cells, chip: `follow the ${d}s`, text: `Follow the <b>${d}s</b>: in several rows, columns and boxes they have only two places.` };
      if (['x-wing', 'swordfish', 'jellyfish', 'x-chain'].includes(x.kind))
        return { cells: x.cells, chip: `follow the ${d}s`, text: `Follow the <b>${d}s</b>: where can they still go?` };
      if (x.kind === 'forcing') return { cells: [x.cells[0]], chip: 'try a note here', text: 'Try each note of this cell: one of them leads to a contradiction.' };
      if (['xy-wing', 'xyz-wing', 'w-wing', 'ur', 'xy-chain'].includes(x.kind))
        return { cells: x.cells, chip: 'look at these cells', text: 'Look at these cells with only two or three notes.' };
      const u = unitOf(x.units[0].split(' → ')[0]);
      return { cells: u.cells, chip: `look in ${u.name}`, text: `Something to find in <b>${u.name}</b>.`, unit: u };
    }


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
      if (it.cat === 'single') return x.kind === 'naked' ? `only ${S(x.d)} fits here` : `only place for ${S(x.d)} in ${x.unit}`;
      return hintWhat(x);
    };

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
    const unitsOfCell = (i) => [UNITS[Math.floor(i / N)], UNITS[N + (i % N)], UNITS[2 * N + boxOf(i)]];
    const hintLabel = (g) => `${KIND_LABEL[g.kind]} ${g.digits.map(S).join('·')} (${g.units.join(' + ')})`;
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

    // Why digit d cannot go in cell i: a placed digit in its row/column/box,
    // an earlier hint that erased it, or the player's own notes.
    function whyNot(i, d, st, a, skipUnit) {
      for (const u of unitsOfCell(i)) {
        if (u.name !== skipUnit && u.cells.some((j) => st.grid[j] === d)) return { key: u.name, text: `${u.name} has ${S(d)}` };
      }
      const h = a.removedBy.get(i + ':' + d);
      if (h != null) return { key: 'h' + h, text: `erased by ${hintLabel(a.hints[h])}` };
      if (a.usesNotes && !st.notes[i].has(d)) return { key: 'notes', text: 'not in your notes' };
      return { key: '?', text: 'excluded' };
    }

    const KIND_LABEL = { pair: 'Pair', triple: 'Triple', 'hidden pair': 'Hidden pair', 'hidden triple': 'Hidden triple', pointing: 'Pointing', coloring: 'Chain',
      quad: 'Quad', 'hidden quad': 'Hidden quad', 'x-wing': 'X-wing', swordfish: 'Swordfish', jellyfish: 'Jellyfish', 'xy-wing': 'XY-wing',
      'xyz-wing': 'XYZ-wing', 'w-wing': 'W-wing', ur: 'Unique rectangle', 'x-chain': 'X-chain', 'xy-chain': 'XY-chain', forcing: 'Forcing chain' };

    return { S, ASSIST_RANK, CHAIN_NAMES, FISH_NAME, KIND_LABEL, WING_NAME, alreadyNoted, assistList, assistUnit, assistWhat, cap, conflictText, hintDigitsIn, hintLabel, hintLook, hintWhat, hintWhy, shadeOf, unitOf, unitsOfCell, whyNot };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createExplainer };
  else root.createExplainer = createExplainer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
