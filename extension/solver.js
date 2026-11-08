// Sudoku Hint Panel — the "any grid" page: paste or type a sudoku of any size
// (4×4 … 16×16) and get the panel's help on it: notes, step-by-step assist,
// fill in, and every hint by technique. The engine runs in solver-worker.js.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const boardEl = $('#board'), statusEl = $('#status'), checkEl = $('#check'), cardEl = $('#card'), legendEl = $('#legend');
  const gradeEl = $('.grade'), catsEl = $('#cats');
  const CAT_NAMES = { single: 'Single options', pointing: 'Pointing', subsets: 'Pairs & triples', coloring: 'Chains',
    quads: 'Quads', fish: 'X-wing & fish', wings: 'Wings', ur: 'Unique rectangles', chains: 'Long chains', forcing: 'Forcing chains' };
  const MAIN_CATS = ['single', 'pointing', 'subsets', 'coloring'], EXPERT_CATS = ['quads', 'fish', 'wings', 'ur', 'chains', 'forcing'];

  // ------------------------------------------------------------ state
  let BR = 3, BC = 3, E, X, Dz, N, NN;
  let symMode = '1G';
  let grid = [], given = [], notes = [];
  const history = [];
  let sel = 0;
  let res = null;              // the worker's last answer for the current grid
  let view = null;             // null | 'assist' | 'one' | { cat } | { hint, cat }
  const assist = { key: null, level: 1, skipped: new Set(), cur: null };
  let hover = null;            // a hint hovered in the Advanced list

  const sym = (d) => {
    if (N <= 9 || symMode === 'num') return String(d);
    if (symMode === '0F') return '0123456789ABCDEFGHIJKLMNOP'[d - 1];
    return '123456789ABCDEFGHIJKLMNOP'[d - 1];
  };
  const valueOf = (ch) => {   // one typed or pasted character → digit (0 = none)
    ch = ch.toUpperCase();
    const set = N > 9 && symMode === '0F' ? '0123456789ABCDEFGHIJKLMNOP' : '123456789ABCDEFGHIJKLMNOP';
    const k = set.indexOf(ch);
    return k >= 0 && k < N ? k + 1 : 0;
  };

  function setSize(br, bc) {
    BR = br; BC = bc; N = BR * BC; NN = N * N;
    E = createSudokuEngine(BR, BC);
    X = createExplainer(E, { symbol: (d) => sym(d) });
    Dz = createDecorator(E, X, (d) => sym(d));
    grid = Array(NN).fill(0); given = Array(NN).fill(false); notes = Array.from({ length: NN }, () => new Set());
    history.length = 0; sel = 0; res = null; view = null; resetAssist();
    $('#size').value = `${BR}x${BC}`;
    $('#symbols-wrap').hidden = N <= 9;
    boardEl.style.setProperty('--n', N); boardEl.style.setProperty('--br', BR); boardEl.style.setProperty('--bc', BC);
    boardEl.classList.toggle('big', N > 9);
    buildBoard();
  }
  function resetAssist() { assist.key = null; assist.level = 1; assist.skipped.clear(); assist.cur = null; }

  // ------------------------------------------------------------ paste
  const SIZES = { 16: [2, 2], 36: [2, 3], 64: [2, 4], 81: [3, 3], 144: [3, 4], 256: [4, 4] };
  function parseGrid(text) {
    const lines = text.split(/\r?\n/).filter((l) => !/^[\s\-+=|_*]*$/.test(l) || /[.*_]/.test(l.replace(/[-+=|]/g, '')));
    const body = lines.join('\n');
    // numbers separated by spaces / commas (16×16 written 1–16)
    const toks = body.split(/[\s,;|]+/).filter((t) => t && !/^[-+=]+$/.test(t));
    if (toks.some((t) => /^\d\d$/.test(t)) && toks.every((t) => /^(\d{1,2}|[.*_?-])$/.test(t)) && SIZES[toks.length]) {
      const [br, bc] = SIZES[toks.length], n = br * bc;
      const vals = toks.map((t) => (/^\d+$/.test(t) && +t >= 1 && +t <= n ? +t : 0));
      return { br, bc, mode: 'num', vals };
    }
    // one character per cell
    const chars = [...body.replace(/[\s|+=]/g, '')];
    const L = chars.length;
    if (!SIZES[L]) return { error: `Found ${L} cells — a grid has 16, 36, 64, 81, 144 or 256.` };
    const [br, bc] = SIZES[L], n = br * bc;
    let mode = '1G';
    if (n === 16) {
      const up = chars.join('').toUpperCase();
      if (!/G/.test(up) && /0/.test(up) && /[.*_?-]/.test(up)) mode = '0F';   // hex: 0 is a digit, . is empty
    }
    const set = n > 9 && mode === '0F' ? '0123456789ABCDEF' : '123456789ABCDEFG';
    const vals = chars.map((c) => { const k = set.indexOf(c.toUpperCase()); return k >= 0 && k < n ? k + 1 : 0; });
    const bad = chars.filter((c) => !/[.*_?0-]/.test(c) && set.indexOf(c.toUpperCase()) < 0).length;
    if (bad > L / 10) return { error: 'Some characters aren’t digits of this grid size.' };
    return { br, bc, mode, vals };
  }
  function loadText(text, keepShape) {
    const p = parseGrid(text);
    if (p.error) return status(p.error, 'err');
    let [br, bc] = [p.br, p.bc];
    const [cbr, cbc] = $('#size').value.split('x').map(Number);
    if (keepShape && cbr * cbc === br * bc) [br, bc] = [cbr, cbc];   // 6×6 / 12×12: keep the chosen box shape
    if (br * bc > 9) symMode = p.mode;
    $('#symbols').value = symMode;
    setSize(br, bc);
    p.vals.forEach((v, i) => { grid[i] = v; given[i] = !!v; });
    save(); request(); status(`Loaded a ${N}×${N} grid with ${p.vals.filter(Boolean).length} digits.`, 'ok');
  }
  function gridText() {
    const rows = [];
    for (let r = 0; r < N; r++) {
      const cells = [];
      for (let c = 0; c < N; c++) { const v = grid[r * N + c]; cells.push(v ? sym(v) : '.'); }
      rows.push(N > 9 && symMode === 'num' ? cells.map((s) => s.padStart(2)).join(' ') : cells.join(''));
    }
    return rows.join('\n');
  }

  // ------------------------------------------------------------ editing
  function snapshot() { history.push({ grid: grid.slice(), notes: notes.map((s) => new Set(s)) }); if (history.length > 300) history.shift(); }
  function undo() {
    const h = history.pop();
    if (!h) return status('Nothing to undo.', 'warn');
    grid = h.grid; notes = h.notes; changed();
  }
  function place(i, d, record = true) {
    if (given[i]) return;
    if (record) snapshot();
    grid[i] = d; notes[i] = new Set();
    if (d) for (const p of E.PEERS[i]) notes[p].delete(d);   // like the games: a placed digit leaves its peers' notes
  }
  function toggleNote(i, d) {
    if (given[i] || grid[i]) return;
    snapshot();
    if (notes[i].has(d)) notes[i].delete(d); else notes[i].add(d);
  }
  function changed() { save(); request(); render(); }

  // ------------------------------------------------------------ the engine (worker)
  const worker = new Worker('solver-worker.js');
  let reqId = 0;
  function request(extra = []) {
    const id = ++reqId;
    document.body.classList.add('busy');
    worker.postMessage({ id, br: BR, bc: BC, grid: grid.slice(), notes: notes.map((s) => [...s]), want: ['count', 'analyse', 'grade', ...extra] });
    return id;
  }
  const waiters = new Map();
  let askId = 0;
  const ask = (want) => new Promise((resolve) => {   // a one-off question (own ids, so it never hides the main answer)
    const id = -(++askId);
    waiters.set(id, resolve);
    worker.postMessage({ id, br: BR, bc: BC, grid: grid.slice(), notes: notes.map((s) => [...s]), want });
  });
  worker.onmessage = (e) => {
    const m = e.data;
    if (waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
    if (m.id !== reqId) return;   // an older grid
    document.body.classList.remove('busy');
    res = m;
    if (res.a) Dz.colour(res.a);
    render();
  };

  // ------------------------------------------------------------ board
  let cellEls = [], svg;
  function buildBoard() {
    boardEl.innerHTML = '';
    cellEls = [];
    for (let i = 0; i < NN; i++) {
      const r = Math.floor(i / N), c = i % N, el = document.createElement('div');
      el.className = 'cell' + ((c + 1) % BC === 0 && c < N - 1 ? ' br' : '') + ((r + 1) % BR === 0 && r < N - 1 ? ' bb' : '');
      el.dataset.i = i;
      boardEl.appendChild(el);
      cellEls.push(el);
    }
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('links');
    boardEl.appendChild(svg);
  }
  // where note d sits inside cell i, in board fractions
  function notePos(i, d) {
    const r = Math.floor(i / N), c = i % N, k = d - 1;
    return [(c + ((k % BC) + 0.5) / BC) / N, (r + (Math.floor(k / BC) + 0.5) / BR) / N];
  }

  // What to draw (deco.js), then painted by paint().
  const newDeco = () => Dz.blank();
  const drawHint = (D, g, level) => Dz.hint(D, g, level, res.a, grid);
  const drawSingle = (D, sg, level) => Dz.single(D, sg, level, res.a, { grid, notes });
  const singleWhy = (sg) => Dz.singleWhy(sg);

  function render() {
    const D = newDeco();
    const a = res && res.a;
    let legend = '';
    cardEl.hidden = true;
    if (a && view === 'assist') legend = renderAssist(D, a);
    else if (a && view === 'one') {
      const sg = a.singles[0];
      if (sg) { drawSingle(D, sg, 3); legend = `${X.assistWhat({ cat: 'single', item: sg })} — ${singleWhy(sg)}`; }
      else legend = 'No single right now: try 🧭 Assist.';
    } else if (a && view && view.cat) {
      if (hover) { hover.cat === 'single' ? drawSingle(D, hover.item, 3) : drawHint(D, hover.item, 3); legend = hover.cat === 'single' ? singleWhy(hover.item) : X.hintWhy(hover.item); }
      else if (view.cat === 'single') a.singles.forEach((sg) => drawSingle(D, sg, 1));
      else a[view.cat].forEach((g) => drawHint(D, g, 1));
    }
    paint(D);
    legendEl.textContent = legend;
    renderPanel();
  }
  function paint(D) {
    const selV = grid[sel];
    for (let i = 0; i < NN; i++) {
      const el = cellEls[i], v = grid[i];
      el.className = el.className.split(' ').filter((c) => c === 'cell' || c === 'br' || c === 'bb').join(' ');
      if (given[i]) el.classList.add('given');
      if (i === sel) el.classList.add('sel');
      if (selV && v === selV && i !== sel) el.classList.add('same');
      if (res && res.clash && res.clash.includes(i)) el.classList.add('clash');
      D.cls[i].forEach((c) => el.classList.add(c));
      let html = '';
      if (v) html = `<span class="v">${sym(v)}</span>`;
      else if (D.ghost[i]) html = `<span class="v ghost">${sym(D.ghost[i])}</span>`;
      else {
        if (notes[i].size || D.show[i].size) {
          html = '<div class="notes">';
          for (let d = 1; d <= N; d++) {
            const has = notes[i].has(d), extra = D.note[i].get(d), on = has || D.show[i].has(d);
            if (!on) { html += '<i></i>'; continue; }
            const cls = (extra ? extra[0] : '') + (!has && !extra ? ' auto' : '');
            html += `<i class="${cls}"${extra && extra[1] ? ` style="--c:${extra[1]}"` : ''}>${sym(d)}</i>`;
          }
          html += '</div>';
        }
      }
      for (const f of D.frames[i]) html += `<span class="frame${f.dep ? ' dep' : ''}${f.conflict ? ' conflict' : ''}"${f.c ? ` style="--c:${f.c}"` : ''}></span>`;
      for (const m of D.marks[i]) html += m === 'ring' ? '<span class="ring"></span>' : `<span class="no${m === 'nohint' ? ' hint' : ''}">×</span>`;
      el.innerHTML = html;
    }
    svg.innerHTML = D.links.map(([p, q, d]) => {
      const [x1, y1] = notePos(p, d), [x2, y2] = notePos(q, d);
      return `<line x1="${x1 * 100}%" y1="${y1 * 100}%" x2="${x2 * 100}%" y2="${y2 * 100}%"/>`;
    }).join('');
  }

  // ------------------------------------------------------------ assist
  function renderAssist(D, a) {
    const st = { grid, notes };
    const list = X.assistList(a, st);
    let cur = list.find((x) => x.key === assist.key);
    if (!cur) {
      if (assist.key) status(list.length ? '✓ Done — here is the next one.' : '✓ Done.', 'ok');
      let open = list.filter((x) => !assist.skipped.has(x.key));
      if (!open.length && list.length) { assist.skipped.clear(); open = list; }
      cur = open[0] || null;
      assist.key = cur ? cur.key : null; assist.level = 1;
    }
    assist.cur = cur;
    cardEl.hidden = false;
    if (!cur) {
      cardEl.innerHTML = `<div class="t">${grid.includes(0) ? 'No hint found' : 'Solved 🎉'}</div><small>${grid.includes(0) ? 'Nothing the panel knows applies here.' : ''}</small>`;
      return '';
    }
    const x = cur.item, lvl = assist.level;
    let text;
    if (lvl === 1) {
      const look = cur.cat === 'single' ? { cells: X.assistUnit(cur).cells, text: `Something to find in <b>${X.assistUnit(cur).name}</b>.` } : X.hintLook(x);
      look.cells.forEach((j) => D.cls[j].add('look'));
      text = look.text;
    } else if (cur.cat === 'single') { drawSingle(D, x, lvl); text = X.assistWhat(cur) + (lvl === 3 ? `<br><small>${singleWhy(x)}</small>` : ''); }
    else { drawHint(D, x, lvl); text = X.assistWhat(cur) + (lvl === 3 ? `<br><small>${X.hintWhy(x)}</small>` : ''); }
    const step = x.step > 1 ? ` · step ${x.step}` : '';
    cardEl.innerHTML = `<div class="t">${['Where to look', 'What', 'Why'][lvl - 1]}${step}</div><div>${text}</div>
      <div class="row">${lvl < 3 ? '<button data-act="more">More ›</button>' : ''}<button data-act="apply" class="main">Apply</button><button data-act="skip">Skip</button></div>`;
    return '';
  }
  function applyCurrent() {
    const cur = assist.cur;
    if (!cur) return;
    if (cur.cat === 'single') { place(cur.item.i, cur.item.d); }
    else {
      snapshot();
      if (!notes.some((s, i) => s.size && !grid[i])) notes = res.a.cand.map((c) => new Set(c || []));   // erasing needs notes: start from the candidates
      for (const [j, ds] of cur.item.elims) ds.forEach((d) => notes[j].delete(d));
    }
    changed();
  }

  // ------------------------------------------------------------ panel
  function renderPanel() {
    document.querySelectorAll('[data-act="assist"]').forEach((b) => b.classList.toggle('on', view === 'assist'));
    document.querySelectorAll('[data-act="one"]').forEach((b) => b.classList.toggle('on', view === 'one'));
    // check line
    let msg = '', kind = '';
    if (!res) msg = '…';
    else if (res.error) { msg = 'Error: ' + res.error; kind = 'err'; }
    else if (res.clash && res.clash.length) { msg = '✗ A digit appears twice in a row, column or box (red).'; kind = 'err'; }
    else if (!grid.some(Boolean)) msg = 'Empty grid: paste one, or type the digits.';
    else if (res.solutions === 0) { msg = '✗ No solution fits these digits — check for a typo.'; kind = 'err'; }
    else if (res.solutions >= 2) { msg = '⚠ Several solutions: a real sudoku has one. Hints still work, but some may be missing.'; kind = 'warn'; }
    else if (res.solutions === -1) { msg = 'Too open to check that the solution is unique.'; kind = 'warn'; }
    else if (!grid.includes(0)) { msg = '✓ Solved.'; kind = 'ok'; }
    else { msg = `✓ One solution · ${grid.filter((v) => !v).length} cells to fill`; kind = 'ok'; }
    if (res && res.a && res.a.badNotes.length) { msg = `✎ ${res.a.badNotes.length} cell${res.a.badNotes.length > 1 ? 's have' : ' has'} its real digit erased from the notes — notes ignored.`; kind = 'warn'; }
    checkEl.textContent = msg; checkEl.className = 'check ' + kind;
    // grade
    const g = res && res.grade;
    gradeEl.hidden = !g;
    if (g) {
      if (N === 9) {
        gradeEl.textContent = `${g.score}/10`;
        gradeEl.style.setProperty('--h', String(Math.round(130 - Math.max(0, g.score - 1) * 13)));
        gradeEl.title = g.score === 0 ? 'Grid solved: 0/10' : `Like a sudoku.com ${E.GRADE_LEVELS[g.score - 1]} grid: ${g.score}/10. Hardest step: ${E.TECH_NAMES[g.tech]}.`;
      } else {
        gradeEl.textContent = g.score === 0 ? 'solved' : `needs: ${E.TECH_NAMES[g.tech]}`;
        gradeEl.style.setProperty('--h', String(Math.round(130 - Math.max(0, g.tech - 1) * 13)));
        gradeEl.title = 'Hardest technique needed for what’s left (the /10 scale is set for 9×9 grids).';
      }
    }
    // advanced list
    const a = res && res.a;
    const counts = (c) => (a ? (c === 'single' ? a.singles.length : a[c].length) : 0);
    const item = (c) => {
      const n = counts(c), on = view && view.cat === c;
      let li = `<li data-cat="${c}" class="${n ? '' : 'empty'}${on ? ' on' : ''}">${CAT_NAMES[c]}<b>${n}</b></li>`;
      if (on && n) {
        const list = c === 'single' ? a.singles : a[c];
        li += '<ol>' + list.slice(0, 40).map((h, k) => `<li data-hint="${c}:${k}">${c === 'single' ? X.assistWhat({ cat: 'single', item: h }) + ` (${X.unitsOfCell(h.i)[0].name}, ${X.unitsOfCell(h.i)[1].name})` : X.hintWhat(h)}${h.step > 1 ? ` · step ${h.step}` : ''}</li>`).join('') + '</ol>';
      }
      return li;
    };
    catsEl.innerHTML = MAIN_CATS.map(item).join('') + '<li class="exp">Expert</li>' + EXPERT_CATS.map(item).join('');
  }
  let statusTimer = 0;
  function status(msg, kind = '') {
    statusEl.textContent = msg; statusEl.className = 'status ' + kind;
    clearTimeout(statusTimer); statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 6000);
  }

  // ------------------------------------------------------------ actions
  async function act(name, btn) {
    const a = res && res.a;
    switch (name) {
      case 'cands':
        snapshot(); notes = E.candidates(grid).map((c) => new Set(c || [])); changed(); status('Candidates written in every empty cell.', 'ok'); break;
      case 'optimized': {
        const r = await ask(['optimized']);
        if (!r.optimized) return status('Fix the grid first.', 'err');
        snapshot();
        notes = r.optimized.map((c, i) => (c && r.solution && !c.has(r.solution[i]) ? new Set(E.candidates(grid)[i]) : new Set(c || [])));
        changed(); status('Optimized notes: narrowed by pairs, triples, pointing and chains.', 'ok'); break;
      }
      case 'clearnotes': snapshot(); notes = notes.map(() => new Set()); changed(); break;
      case 'assist': view = view === 'assist' ? null : 'assist'; resetAssist(); render(); break;
      case 'one': view = view === 'one' ? null : 'one'; render(); break;
      case 'more': if (assist.level < 3) { assist.level++; render(); } break;
      case 'skip': if (assist.key) { assist.skipped.add(assist.key); assist.key = null; render(); } break;
      case 'apply': applyCurrent(); break;
      case 'singles': {
        if (!a) return status('Fix the grid first.', 'err');
        if (!a.singles.length) return status('No single right now.', 'warn');
        snapshot(); a.singles.forEach((sg) => place(sg.i, sg.d, false)); changed();
        status(`Filled ${a.singles.length} cell${a.singles.length > 1 ? 's' : ''}.`, 'ok'); break;
      }
      case 'finish': {
        if (!btn.classList.contains('armed')) {
          btn.classList.add('armed'); btn.textContent = 'Click to confirm';
          setTimeout(() => { btn.classList.remove('armed'); btn.textContent = '🏁 Finish grid'; }, 4000);
          return;
        }
        btn.classList.remove('armed'); btn.textContent = '🏁 Finish grid';
        const r = await ask(['count', 'path']);
        if (!r.path) return status('No solution fits these digits.', 'err');
        snapshot();
        view = null;
        for (const s of r.path.steps) {
          place(s.i, s.d, false); sel = s.i;
          status(`Finishing: ${E.TECH_NAMES[s.tech]}…`, 'ok');
          paint(newDeco());
          await new Promise((ok) => setTimeout(ok, N > 9 ? 25 : 60));
        }
        changed(); status(`Finished: ${r.path.steps.length} digits, simplest first.` + (r.path.unreached ? ` ${r.path.unreached} came from the solution.` : ''), 'ok');
        break;
      }
    }
  }

  // ------------------------------------------------------------ events
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) { act(b.dataset.act, b); return; }
    const c = e.target.closest('.cell');
    if (c) { sel = +c.dataset.i; boardEl.focus(); render(); return; }
    const h = e.target.closest('[data-hint]');
    if (h) { const [cat, k] = h.dataset.hint.split(':'); const list = cat === 'single' ? res.a.singles : res.a[cat]; hover = { cat, item: list[+k] }; render(); return; }
    const li = e.target.closest('#cats li[data-cat]');
    if (li && !li.classList.contains('empty')) { hover = null; view = view && view.cat === li.dataset.cat ? null : { cat: li.dataset.cat }; render(); }
  });
  catsEl.addEventListener('mouseover', (e) => {
    const h = e.target.closest('[data-hint]');
    if (!h || !res || !res.a) return;
    const [cat, k] = h.dataset.hint.split(':'); const list = cat === 'single' ? res.a.singles : res.a[cat];
    const it = { cat, item: list[+k] };
    if (!hover || hover.item !== it.item) { hover = it; render(); }
  });
  catsEl.addEventListener('mouseleave', () => { if (hover) { hover = null; render(); } });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const r = Math.floor(sel / N), c = sel % N;
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (move) { e.preventDefault(); sel = ((r + move[0] + N) % N) * N + ((c + move[1] + N) % N); render(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); if (grid[sel]) { place(sel, 0); changed(); } return; }
    // the symbol typed, from the key's position so Shift+digit works on every layout
    const m = /^(?:Digit|Numpad)(\d)$|^Key([A-Z])$/.exec(e.code);
    const ch = m ? (m[1] || m[2]) : e.key.length === 1 ? e.key : '';
    if (!ch) return;
    if (ch === '0' && !(N > 9 && symMode === '0F')) { if (grid[sel]) { place(sel, 0); changed(); } return; }
    const d = valueOf(ch);
    if (!d) return;
    e.preventDefault();
    if (e.shiftKey) toggleNote(sel, d);
    else if (!given[sel]) place(sel, d);
    changed();
  });
  $('#load').onclick = () => loadText($('#paste').value, true);
  $('#empty').onclick = () => { const [br, bc] = $('#size').value.split('x').map(Number); setSize(br, bc); save(); request(); render(); };
  $('#undo').onclick = undo;
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(gridText()); status('Grid copied as text.', 'ok'); } catch (err) { $('#paste').value = gridText(); status('Grid written in the box above.', 'ok'); } };
  $('#size').onchange = () => { const [br, bc] = $('#size').value.split('x').map(Number); setSize(br, bc); save(); request(); render(); };
  $('#symbols').onchange = () => { symMode = $('#symbols').value; save(); render(); };

  // the last grid, kept in this browser only
  function save() {
    try { localStorage.setItem('sdkh_solver', JSON.stringify({ BR, BC, symMode, grid, given, notes: notes.map((s) => [...s]) })); } catch (err) { /* private mode */ }
  }
  function restore() {
    try {
      const o = JSON.parse(localStorage.getItem('sdkh_solver') || 'null');
      if (!o || !o.BR) return false;
      symMode = o.symMode || '1G'; $('#symbols').value = symMode;
      setSize(o.BR, o.BC);
      if (o.grid.length !== NN) return false;
      grid = o.grid; given = o.given; notes = o.notes.map((x) => new Set(x));
      return true;
    } catch (err) { return false; }
  }

  // a grid passed in the address (…/solver.html#grid=…), e.g. from the sudoku.com panel
  const fromHash = /[#&]grid=([^&]+)/.exec(location.hash);
  if (fromHash) { loadText(decodeURIComponent(fromHash[1]), false); history.length = 0; }
  else if (!restore()) {
    setSize(3, 3);
    const demo = '000041090004000006080000070000500000007300800002060305649802000721906000358000000';
    [...demo].forEach((ch, i) => { grid[i] = +ch; given[i] = ch !== '0'; });
  }
  request(); render();
})();
