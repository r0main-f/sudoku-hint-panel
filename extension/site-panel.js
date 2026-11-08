// Sudoku Hint Panel on other sudoku sites (NYT, Web Sudoku, LiveSudoku, sudoku-online.org,
// sudokuonline.io). Two roles, talking by window messages so the grid may sit in a frame:
//  - the grid agent, in whichever frame shows the grid: reads it with the site's adapter
//    (sites.js), draws the overlay on it, and types digits when asked;
//  - the panel, in the top page only: runs the engine (engine.js, explain.js, deco.js),
//    shows the same help as on sudoku.com, and tells the agent what to draw and type.
(() => {
  'use strict';
  if (window.__sdkh2) return;
  window.__sdkh2 = true;
  const TAG = 'sdkh2';
  const send = (target, msg) => { try { target.postMessage({ [TAG]: msg }, '*'); } catch (e) { /* frame gone */ } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ================================================================ grid agent (any frame)
  (function agent() {
    let adapter = null, lastKey = '', deco = null, overlay = null, raf = 0;
    const boardRect = (els) => {
      const a = els[0].getBoundingClientRect(), b = els[80].getBoundingClientRect();
      return { left: a.left, top: a.top, right: b.right, bottom: b.bottom, width: b.right - a.left, height: b.bottom - a.top };
    };
    // on screen, big enough, and not hidden under a pop-up or an ad
    function visible(els) {
      const r = boardRect(els);
      if (r.width < 120 || r.height < 120) return false;
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0), h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0 || (w * h) / (r.width * r.height) < 0.4) return false;
      let covered = 0;
      for (const i of [10, 16, 40, 64, 70]) {
        const c = els[i].getBoundingClientRect(), x = c.left + c.width / 2, y = c.top + c.height / 2;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const at = document.elementFromPoint(x, y);
        if (at && !(at === els[i] || els[i].contains(at) || at.contains(els[i]) || (overlay && overlay.contains(at)))) covered++;
      }
      return covered < 3;
    }
    function poll() {
      if (!adapter) adapter = SDKH_SITES.findAdapter();
      if (!adapter) return;
      let st = null, els = null;
      try { els = adapter.cells(); st = els && adapter.read(); } catch (e) { st = null; }
      const vis = !!(st && visible(els));
      const key = vis ? st.grid.join('') + '|' + st.notes.map((n) => n.join('')).join(',') : 'hidden';
      if (key !== lastKey) { lastKey = key; send(window.top, { type: 'state', site: adapter.id, name: adapter.name, visible: vis, ...(vis ? st : {}) }); }
      if (!vis && overlay) overlay.hidden = true;
      else if (overlay && deco) { overlay.hidden = false; place(); }
    }
    // ---- the overlay
    function ensureOverlay() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.className = 'sdkh2-overlay';
      document.documentElement.appendChild(overlay);
      addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); }, true);
      addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); });
    }
    function paint() {
      ensureOverlay();
      overlay.innerHTML = '';
      if (!deco || !adapter) return;
      const D = deco;
      for (let i = 0; i < 81; i++) {
        const has = D.cls[i].size || D.ghost[i] || D.frames[i].length || D.marks[i].length || D.note[i].size || D.show[i].size;
        if (!has) continue;
        const el = document.createElement('div');
        el.className = 'sdkh2-cell ' + [...D.cls[i]].join(' ');
        el.dataset.i = i;
        let html = '';
        if (D.ghost[i]) html += `<span class="sdkh2-ghost">${D.ghost[i]}</span>`;
        else if (D.note[i].size || D.show[i].size) {
          html += '<div class="sdkh2-notes">';
          for (let d = 1; d <= 9; d++) {
            const n = D.note[i].get(d);
            if (n) html += `<i class="${n[0]}"${n[1] ? ` style="--c:${n[1]}"` : ''}>${d}</i>`;
            else if (D.show[i].has(d) && D.plain) html += `<i class="plain">${d}</i>`;
            else html += '<i></i>';
          }
          html += '</div>';
        }
        for (const f of D.frames[i]) html += `<span class="sdkh2-frame${f.dep ? ' dep' : ''}${f.conflict ? ' conflict' : ''}"${f.c ? ` style="--c:${f.c}"` : ''}></span>`;
        for (const m of D.marks[i]) html += m === 'ring' ? '<span class="sdkh2-ring"></span>' : `<span class="sdkh2-no${m === 'nohint' ? ' hint' : ''}">×</span>`;
        el.innerHTML = html;
        overlay.appendChild(el);
      }
      if (D.links.length) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('sdkh2-links');
        overlay.appendChild(svg);
      }
      place();
    }
    // keep the overlay on the cells as the page scrolls or resizes
    function place() {
      if (!overlay || !adapter || !deco) return;
      const els = adapter.cells();
      if (!els) return;
      for (const el of overlay.querySelectorAll('.sdkh2-cell')) {
        const r = els[+el.dataset.i].getBoundingClientRect();
        el.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;font-size:${Math.round(r.height * 0.6)}px`;
        const notes = el.querySelector('.sdkh2-notes');
        if (notes) notes.style.fontSize = Math.round(r.height * 0.27) + 'px';
      }
      const svg = overlay.querySelector('.sdkh2-links');
      if (svg) {
        const at = (i, d) => { const r = els[i].getBoundingClientRect(); return [r.left + r.width * (((d - 1) % 3) + 0.5) / 3, r.top + r.height * (Math.floor((d - 1) / 3) + 0.5) / 3]; };
        svg.innerHTML = deco.links.map(([p, q, d]) => { const [x1, y1] = at(p, d), [x2, y2] = at(q, d); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }).join('');
      }
    }
    // ---- messages from the panel
    addEventListener('message', async (e) => {
      const m = e.data && e.data[TAG];
      if (!m || !adapter) return;
      if (m.type === 'hello') { lastKey = ''; poll(); }
      else if (m.type === 'deco') { deco = m.deco; paint(); }
      else if (m.type === 'put') {
        let ok = true;
        for (const [i, d] of m.moves) {
          try { await adapter.put(i, d); } catch (err) { ok = false; break; }
          await sleep(m.delay || 30);
        }
        lastKey = ''; poll();
        send(e.source, { type: 'done', id: m.id, ok });
      }
    });
    const mo = new MutationObserver((recs) => {
      if (overlay && recs.every((r) => overlay.contains(r.target))) return;   // our own drawing
      clearTimeout(mo.t); mo.t = setTimeout(poll, 60);
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['class', 'aria-label', 'data-value', 'value', 'style'] });
    addEventListener('input', () => setTimeout(poll, 30), true);
    setInterval(poll, 700);
    poll();
  })();

  // ================================================================ panel (top page only)
  if (window !== window.top) return;
  const E = createSudokuEngine(3, 3), X = createExplainer(E), Dz = createDecorator(E, X);
  const CAT_NAMES = { single: 'Single options', pointing: 'Pointing', subsets: 'Pairs & triples', coloring: 'Chains',
    quads: 'Quads', fish: 'X-wing & fish', wings: 'Wings', ur: 'Unique rectangles', chains: 'Long chains', forcing: 'Forcing chains' };
  const MAIN_CATS = ['single', 'pointing', 'subsets', 'coloring'], EXPERT_CATS = ['quads', 'fish', 'wings', 'ur', 'chains', 'forcing'];
  let src = null, st = null, a = null, grade = null, siteName = '';
  let view = null, showCands = false, hover = null;
  const assist = { key: null, level: 1, skipped: new Set(), cur: null };
  const virt = new Set();   // notes erased with Apply on this page ("cell:digit"), for sites without notes of their own
  let putId = 0;
  const waiting = new Map();

  const panel = document.createElement('div');
  panel.className = 'sdkh2-panel idle';
  panel.innerHTML = `
    <div class="sdkh2-head"><span>⠿ Sudoku Hint Panel</span><b class="sdkh2-grade" hidden></b><button class="sdkh2-min" title="Minimise">–</button></div>
    <div class="sdkh2-body">
      <p class="sdkh2-idle">Open a puzzle: hints appear when its grid is on screen.</p>
      <div class="sdkh2-sec first"><b>1 · Notes</b><small>no answers given</small></div>
      <div class="sdkh2-row"><button class="b" data-act="cands" title="Show every possible digit in every empty cell (drawn over the grid, not typed)">✎ Candidates</button><button class="b" data-act="clearv" title="Forget the notes erased with Apply">↺ Reset notes</button></div>
      <div class="sdkh2-sec"><b>2 · Step by step assist</b><small>one at a time</small></div>
      <div class="sdkh2-row"><button class="b" data-act="assist" title="The easiest hint left: where to look, then what, then why">🧭 Assist</button><button class="b" data-act="one" title="Show one next move">☝ ONE single</button></div>
      <div class="sdkh2-card" hidden></div>
      <div class="sdkh2-sec"><b>3 · Fill in</b><small>answers typed for you</small></div>
      <div class="sdkh2-row"><button class="b" data-act="singles" title="Type the digit in every cell where only one fits">⚡ Fill singles</button><button class="b" data-act="finish" title="Type the rest of the solution, one digit at a time in the order you could find it (click twice)">🏁 Finish grid</button></div>
      <details class="sdkh2-adv"><summary class="sdkh2-sec"><b>4 · Advanced</b><small>all hints at once</small></summary><ul class="sdkh2-cats"></ul></details>
      <p class="sdkh2-status"></p>
      <p class="sdkh2-fair">For learning: please don't use hints in ranked or competitive games.</p>
    </div>`;
  const $p = (s) => panel.querySelector(s);
  const mount = () => { if (!panel.isConnected && document.body) document.body.appendChild(panel); };
  mount();
  setInterval(mount, 2000);   // some sites rebuild the page body

  let statusT = 0;
  function status(msg, kind = '') {
    const el = $p('.sdkh2-status'); el.textContent = msg; el.className = 'sdkh2-status ' + kind;
    clearTimeout(statusT); statusT = setTimeout(() => { el.textContent = ''; }, 6000);
  }

  // the notes the engine works from: the site's own when it has them, otherwise
  // the candidates minus what Apply erased here
  function stateFor(s) {
    const grid = s.grid, siteNotes = s.notes.some((n) => n.length);
    if (siteNotes) return { grid, notes: s.notes.map((n) => new Set(n)) };
    if (!virt.size) return { grid, notes: grid.map(() => new Set()) };
    const cand = E.candidates(grid);
    return { grid, notes: cand.map((c, i) => (c ? new Set([...c].filter((d) => !virt.has(i + ':' + d))) : new Set())) };
  }
  let anaT = 0;
  function analyseSoon() {
    clearTimeout(anaT);
    anaT = setTimeout(() => {
      a = null; grade = null;
      if (st && st.grid.includes(0) && E.solveGrid(st.grid)) {
        a = E.analyse(st); Dz.colour(a);
        grade = E.gradeGrid(st.grid);
      } else if (st && !st.grid.includes(0)) grade = { score: 0 };
      render();
    }, 20);
  }

  addEventListener('message', (e) => {
    const m = e.data && e.data[TAG];
    if (!m) return;
    if (m.type === 'state') {
      if (!m.visible) { if (e.source === src) { st = null; a = null; render(); } return; }
      src = e.source; siteName = m.name;
      for (const k of [...virt]) { const [i, d] = k.split(':').map(Number); if (m.grid[i] || m.grid.some((v, j) => v === d && E.PEERS[i].includes(j))) virt.delete(k); }
      st = stateFor(m);
      analyseSoon();
    } else if (m.type === 'done' && waiting.has(m.id)) { waiting.get(m.id)(m.ok); waiting.delete(m.id); }
  });
  const put = (moves, delay) => new Promise((resolve) => { const id = ++putId; waiting.set(id, resolve); send(src, { type: 'put', id, moves, delay }); });
  send(window, { type: 'hello' });
  for (const f of document.querySelectorAll('iframe')) send(f.contentWindow, { type: 'hello' });

  // ---------------------------------------------------------------- what to draw
  function render() {
    const idle = !st;
    panel.classList.toggle('idle', idle);
    $p('.sdkh2-head').title = siteName ? `On ${siteName} · drag to move` : 'Drag to move';
    const D = Dz.blank();
    let card = '';
    if (a) {
      if (showCands) { D.plain = true; a.cand.forEach((c, i) => { if (c) (a.usesNotes ? st.notes[i] : c).forEach((d) => D.show[i].add(d)); }); }
      if (view === 'assist') card = renderAssist(D);
      else if (view === 'one') {
        const sg = a.singles[0];
        if (sg) { Dz.single(D, sg, 3, a, st); card = `<div class="t">${X.assistWhat({ cat: 'single', item: sg })}</div><small>${Dz.singleWhy(sg)}</small>`; }
        else card = '<div class="t">No single right now</div><small>Try 🧭 Assist.</small>';
      } else if (view && view.cat) {
        if (hover) { hover.cat === 'single' ? Dz.single(D, hover.item, 3, a, st) : Dz.hint(D, hover.item, 3, a, st.grid); }
        else if (view.cat === 'single') a.singles.forEach((sg) => Dz.single(D, sg, 1, a, st));
        else a[view.cat].forEach((g) => Dz.hint(D, g, 1, a, st.grid));
      }
    } else if (st && view) card = `<div class="t">${st.grid.includes(0) ? 'No solution fits these digits' : 'Solved 🎉'}</div>`;
    if (!showCands) D.show = D.show.map((s, i) => (D.note[i].size ? s : new Set()));   // only the digits a hint is about
    if (src) send(src, { type: 'deco', deco: idle ? null : D });
    const cardEl = $p('.sdkh2-card'); cardEl.hidden = !card; cardEl.innerHTML = card;
    panelState();
  }
  function renderAssist(D) {
    const list = X.assistList(a, st);
    let cur = list.find((x) => x.key === assist.key);
    if (!cur) {
      if (assist.key) status(list.length ? '✓ Done — here is the next one.' : '✓ Done.', 'ok');
      let open = list.filter((x) => !assist.skipped.has(x.key));
      if (!open.length && list.length) { assist.skipped.clear(); open = list; }
      cur = open[0] || null; assist.key = cur ? cur.key : null; assist.level = 1;
    }
    assist.cur = cur;
    if (!cur) return '<div class="t">No hint found</div><small>Nothing the panel knows applies here.</small>';
    const x = cur.item, lvl = assist.level;
    let text;
    if (lvl === 1) {
      const look = cur.cat === 'single' ? { cells: X.assistUnit(cur).cells, text: `Something to find in <b>${X.assistUnit(cur).name}</b>.` } : X.hintLook(x);
      look.cells.forEach((j) => D.cls[j].add('look'));
      text = look.text;
    } else if (cur.cat === 'single') { Dz.single(D, x, lvl, a, st); text = X.assistWhat(cur) + (lvl === 3 ? `<br><small>${Dz.singleWhy(x)}</small>` : ''); }
    else { Dz.hint(D, x, lvl, a, st.grid); text = X.assistWhat(cur) + (lvl === 3 ? `<br><small>${X.hintWhy(x)}</small>` : ''); }
    return `<div class="t">${['Where to look', 'What', 'Why'][lvl - 1]}${x.step > 1 ? ` · step ${x.step}` : ''}</div><div>${text}</div>
      <div class="acts">${lvl < 3 ? '<button data-act="more">More ›</button>' : ''}<button data-act="apply" class="main">Apply</button><button data-act="skip">Skip</button></div>`;
  }
  function panelState() {
    for (const b of panel.querySelectorAll('[data-act="assist"]')) b.classList.toggle('on', view === 'assist');
    for (const b of panel.querySelectorAll('[data-act="one"]')) b.classList.toggle('on', view === 'one');
    for (const b of panel.querySelectorAll('[data-act="cands"]')) b.classList.toggle('on', showCands);
    const g = $p('.sdkh2-grade');
    g.hidden = !grade || !st;
    if (grade && st) {
      g.textContent = `${grade.score}/10`;
      g.style.setProperty('--h', String(Math.round(130 - Math.max(0, grade.score - 1) * 13)));
      g.title = grade.score ? `Like a sudoku.com ${E.GRADE_LEVELS[grade.score - 1]} grid: ${grade.score}/10. Hardest step: ${E.TECH_NAMES[grade.tech]}.` : 'Solved: 0/10';
    }
    const n = (c) => (a ? (c === 'single' ? a.singles.length : a[c].length) : 0);
    const li = (c) => {
      const on = view && view.cat === c;
      let h = `<li data-cat="${c}" class="${n(c) ? '' : 'empty'}${on ? ' on' : ''}">${CAT_NAMES[c]}<b>${n(c)}</b></li>`;
      if (on && n(c)) h += '<ol>' + (c === 'single' ? a.singles : a[c]).slice(0, 30).map((x, k) => `<li data-hint="${c}:${k}">${c === 'single' ? X.assistWhat({ cat: 'single', item: x }) : X.hintWhat(x)}</li>`).join('') + '</ol>';
      return h;
    };
    $p('.sdkh2-cats').innerHTML = MAIN_CATS.map(li).join('') + EXPERT_CATS.filter((c) => n(c)).map(li).join('');
  }

  // ---------------------------------------------------------------- actions
  async function act(name, btn) {
    if (!st) return;
    switch (name) {
      case 'cands': showCands = !showCands; render(); break;
      case 'clearv': virt.clear(); if (src) send(src, { type: 'hello' }); status('Notes reset.', 'ok'); break;
      case 'assist': view = view === 'assist' ? null : 'assist'; assist.key = null; assist.skipped.clear(); render(); break;
      case 'one': view = view === 'one' ? null : 'one'; render(); break;
      case 'more': if (assist.level < 3) { assist.level++; render(); } break;
      case 'skip': if (assist.key) { assist.skipped.add(assist.key); assist.key = null; render(); } break;
      case 'apply': {
        const cur = assist.cur;
        if (!cur) break;
        if (cur.cat === 'single') await put([[cur.item.i, cur.item.d]]);
        else { for (const [j, ds] of cur.item.elims) ds.forEach((d) => virt.add(j + ':' + d)); send(src, { type: 'hello' }); }
        break;
      }
      case 'singles': {
        if (!a || !a.singles.length) return status('No single right now.', 'warn');
        const moves = a.singles.map((sg) => [sg.i, sg.d]);
        await put(moves); status(`Filled ${moves.length} cell${moves.length > 1 ? 's' : ''}.`, 'ok'); break;
      }
      case 'finish': {
        if (!btn.classList.contains('armed')) {
          btn.classList.add('armed'); btn.textContent = 'Click to confirm';
          setTimeout(() => { btn.classList.remove('armed'); btn.textContent = '🏁 Finish grid'; }, 4000);
          return;
        }
        btn.classList.remove('armed'); btn.textContent = '🏁 Finish grid';
        const path = E.solvePath(st.grid);
        if (!path) return status('No solution fits the digits on the board — check for a mistake.', 'err');
        view = null; render();
        status(`Finishing: ${path.steps.length} digits, simplest first…`, 'ok');
        await put(path.steps.map((s) => [s.i, s.d]), 40);
        status('Finished.', 'ok'); break;
      }
    }
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) { act(b.dataset.act, b); return; }
    if (e.target.closest('.sdkh2-min')) { panel.classList.toggle('min'); return; }
    const h = e.target.closest('[data-hint]');
    if (h && a) { const [c, k] = h.dataset.hint.split(':'); hover = { cat: c, item: (c === 'single' ? a.singles : a[c])[+k] }; render(); return; }
    const li = e.target.closest('.sdkh2-cats li[data-cat]');
    if (li && !li.classList.contains('empty')) { hover = null; view = view && view.cat === li.dataset.cat ? null : { cat: li.dataset.cat }; render(); }
  });
  panel.addEventListener('mouseover', (e) => {
    const h = e.target.closest('[data-hint]');
    if (!h || !a) return;
    const [c, k] = h.dataset.hint.split(':'), item = (c === 'single' ? a.singles : a[c])[+k];
    if (!hover || hover.item !== item) { hover = { cat: c, item }; render(); }
  });
  $p('.sdkh2-cats').addEventListener('mouseleave', () => { if (hover) { hover = null; render(); } });
  // drag by the title bar; the position is kept per site, in this browser
  const POS = 'sdkh2_pos';
  try { const p = JSON.parse(localStorage.getItem(POS) || 'null'); if (p) Object.assign(panel.style, { left: p.x + 'px', top: p.y + 'px', right: 'auto' }); } catch (e) { /* none */ }
  $p('.sdkh2-head').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => {
      const x = Math.max(0, Math.min(innerWidth - 60, ev.clientX - dx)), y = Math.max(0, Math.min(innerHeight - 30, ev.clientY - dy));
      Object.assign(panel.style, { left: x + 'px', top: y + 'px', right: 'auto' });
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      try { const q = panel.getBoundingClientRect(); localStorage.setItem(POS, JSON.stringify({ x: Math.round(q.left), y: Math.round(q.top) })); } catch (err) { /* private mode */ }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
})();
