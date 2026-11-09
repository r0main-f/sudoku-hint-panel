// Sudoku Hint Panel — how to read and play the grid on other sudoku sites.
// One adapter per site, all with the same shape:
//   match()          is this frame showing that site's grid?
//   cells()          the 81 cell elements, in reading order (row by row), or null
//   read()           { grid: [81 digits, 0 = empty], given: [81 booleans], notes: [81 arrays] }
//   put(i, d)        type digit d in cell i (0 erases), the way a player would; returns a Promise
// Only the page's own controls are used (a click on the cell, a key or the site's
// number pad), so every move stays in the site's own history and checks.
(function (root) {
  'use strict';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const host = () => location.hostname.replace(/^www\./, '');
  const digitOf = (t) => { const m = /^\s*([1-9])\s*$/.exec(t || ''); return m ? +m[1] : 0; };
  const pointer = (el) => {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const C = t.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new C(t, { bubbles: true, cancelable: true, composed: true, button: 0, view: window }));
    }
  };
  // a key press with the old keyCode / which fields set too: many games still read those.
  // (Set in the event's init, so the page sees them; a property defined from this
  // content script would stay invisible to the page's own code.)
  const KEYS = { Backspace: 8, Delete: 46 };
  const key = (target, k) => {
    const kc = KEYS[k] || k.charCodeAt(0);
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { key: k, code: /^\d$/.test(k) ? 'Digit' + k : k, keyCode: kc, which: kc,
        bubbles: true, cancelable: true, composed: true, view: window }));
    }
  };
  const noNotes = () => Array.from({ length: 81 }, () => []);

  const ADAPTERS = [
    // ------------------------------------------------------------ The New York Times
    {
      id: 'nyt', name: 'NYT Sudoku',
      match: () => host() === 'nytimes.com' && /^\/puzzles\/sudoku/.test(location.pathname),
      cells() {
        const els = [...document.querySelectorAll('.su-cell[data-cell]')];
        if (els.length !== 81) return null;
        return els.sort((a, b) => a.dataset.cell - b.dataset.cell);
      },
      read() {
        const els = this.cells();
        if (!els) return null;
        const grid = [], given = [];
        for (const el of els) {   // aria-label: "Row 1, column 2, prefilled 4" · "…, 7" · "…, empty"
          const l = el.getAttribute('aria-label') || '', m = /,\s*(prefilled\s+)?([1-9])\s*$/.exec(l);
          grid.push(m ? +m[2] : 0); given.push(!!(m && m[1]) || el.classList.contains('prefilled'));
        }
        return { grid, given, notes: this.notes(grid) };
      },
      // the player's candidates, from the game's own save in this browser
      notes(grid) {
        try {
          for (let k = 0; k < localStorage.length; k++) {
            const name = localStorage.key(k);
            if (!/^xwd-sudoku-(easy|medium|hard)$/.test(name)) continue;
            const s = JSON.parse(localStorage.getItem(name));
            if (!s || !s.cells || Object.values(s.cells).some((c) => (c.value || 0) !== grid[c.id])) continue;   // another day's or level's save
            const src = s.auto ? s.autoCandidates : s.manualCandidates;
            return Array.from({ length: 81 }, (_, i) => (src && src[i] && !grid[i] ? Object.keys(src[i]).filter((d) => src[i][d]).map(Number) : []));
          }
        } catch (e) { /* no save yet */ }
        return noNotes();
      },
      // write the given notes (81 arrays) in Candidate mode, toggling only what differs
      async setNotes(target) {
        const pad = (label) => [...document.querySelectorAll('.su-keyboard button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim() === label);
        const st = this.read();
        if (!st) return;
        const cand = document.querySelector('.su-keyboard__mode.candidate'), normal = document.querySelector('.su-keyboard__mode.normal');
        if (!cand || !pad('Number 1')) throw new Error('no candidate mode');
        pointer(cand); await sleep(30);
        try {
          for (let i = 0; i < 81; i++) {
            if (st.grid[i]) continue;
            const have = new Set(st.notes[i]), want = new Set(target[i]);
            const flip = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => have.has(d) !== want.has(d));
            if (!flip.length) continue;
            pointer(this.cells()[i]); await sleep(8);
            for (const d of flip) { pointer(pad('Number ' + d)); await sleep(8); }
          }
        } finally { if (normal) pointer(normal); await sleep(20); }
      },
      async put(i, d) {
        const pad = (label) => [...document.querySelectorAll('.su-keyboard button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim() === label);
        const normal = document.querySelector('.su-keyboard__mode.normal');
        if (normal && !normal.classList.contains('normalMode')) { pointer(normal); await sleep(20); }   // digits, not candidates
        pointer(this.cells()[i]);
        await sleep(10);
        const b = d ? pad('Number ' + d) : pad('Clear cell');
        if (b) pointer(b); else key(document.activeElement || document.body, d ? String(d) : 'Backspace');
      },
    },

    // ------------------------------------------------------------ Web Sudoku (the grid is in a frame of its own)
    {
      id: 'websudoku', name: 'Web Sudoku',
      match: () => /(^|\.)websudoku\.com$/.test(location.hostname) && !!document.querySelector('#puzzle_grid'),
      cells() {
        const out = [];
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
          const el = document.getElementById(`f${c}${r}`);   // id = f + column + row
          if (!el) return null;
          out.push(el);
        }
        return out;
      },
      read() {
        const els = this.cells();
        if (!els) return null;
        return { grid: els.map((el) => digitOf(el.value)), given: els.map((el) => el.readOnly), notes: noNotes() };
      },
      async put(i, d) {
        const el = this.cells()[i];
        if (el.readOnly) return;
        el.focus();
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, d ? String(d) : '');
        for (const t of ['input', 'keyup', 'change']) el.dispatchEvent(new Event(t, { bubbles: true }));
      },
    },

    // ------------------------------------------------------------ sudoku-online.org
    {
      id: 'sudoku-online', name: 'Sudoku Online (sudoku-online.org)',
      match: () => host() === 'sudoku-online.org' && !!document.getElementById('sudo_input_80'),
      cells() {
        const out = [];
        for (let i = 0; i < 81; i++) { const el = document.getElementById('sudo_input_' + i); if (!el) return null; out.push(el); }
        return out;
      },
      read() {
        const els = this.cells();
        if (!els) return null;
        return { grid: els.map((el) => digitOf(el.textContent)), given: els.map((el) => el.classList.contains('no_select')), notes: noNotes() };
      },
      async put(i, d) {
        const el = this.cells()[i];
        el.focus();
        pointer(el);
        key(el, d ? String(d) : 'Delete');
      },
    },

    // ------------------------------------------------------------ LiveSudoku
    {
      id: 'livesudoku', name: 'LiveSudoku',
      match: () => host() === 'livesudoku.com' && !!document.querySelector('#playtable #td80'),
      cells() {
        const out = [];
        for (let i = 0; i < 81; i++) { const el = document.getElementById('td' + i); if (!el) return null; out.push(el); }
        return out;
      },
      read() {
        const els = this.cells();
        if (!els) return null;
        const valueOf = (el) => { const s = el.querySelector('.fixedcell, .varcell'); return s ? digitOf(s.textContent) : 0; };
        // pencil marks: <div class="pencilmarkscell"><span class="hintnumber">3</span><span class="hintblank">…
        const marks = (el) => [...el.querySelectorAll('.pencilmarkscell .hintnumber')].map((x) => digitOf(x.textContent)).filter(Boolean);
        return { grid: els.map(valueOf), given: els.map((el) => !!el.querySelector('.fixedcell')), notes: els.map(marks) };
      },
      // Only when the player has "Pencil Marks" switched on: otherwise every digit typed is an answer.
      canNote() { const box = document.getElementById('allowmarks'); return !!box && box.checked; },
      // Pencil marks are typed like digits: a second digit in a cell turns it into marks, and
      // from then on each digit toggles. So: clear the cell, then type the marks it should have.
      // A cell with a single candidate keeps no mark (one digit would be an answer). Each cell is
      // checked right after: if the game kept a digit instead of marks, the cell is cleared and
      // writing stops, so a note can never end up as an answer.
      async setNotes(target) {
        if (!this.canNote()) throw new Error('pencil marks are off');
        const st = this.read();
        if (!st) return;
        const els = this.cells();
        let single = 0;
        for (let i = 0; i < 81; i++) {
          if (st.grid[i]) continue;
          if (target[i].length === 1) single++;
          const want = target[i].length >= 2 ? target[i] : [];
          if (want.join() === st.notes[i].join()) continue;
          pointer(els[i]); await sleep(8);
          if (st.notes[i].length) { key(document.body, 'Delete'); await sleep(8); }
          for (const d of want) { key(document.body, String(d)); await sleep(8); }
          if (els[i].querySelector('.varcell')) {
            key(document.body, 'Delete'); await sleep(8);
            throw new Error('the game kept a digit instead of pencil marks');
          }
        }
        return { single };
      },
      async put(i, d) {
        const el = this.cells()[i];
        pointer(el);   // the cell's own onmousedown selects it
        await sleep(10);
        // a digit typed over marks or over another digit would become a pencil mark: clear the cell first
        if (el.querySelector('.pencilmarkscell, .varcell')) { key(document.body, 'Delete'); await sleep(10); }
        if (d) key(document.body, String(d));   // the page listens on <body onkeydown>
      },
    },

    // ------------------------------------------------------------ sudokuonline.io
    {
      id: 'sudokuonline', name: 'Sudoku Online (sudokuonline.io)',
      match: () => host() === 'sudokuonline.io' && document.querySelectorAll('.cell[data-celln]').length === 81,
      cells() {
        const els = [...document.querySelectorAll('.cell[data-celln]')];
        return els.length === 81 ? els.sort((a, b) => a.dataset.celln - b.dataset.celln) : null;
      },
      read() {
        const els = this.cells();
        if (!els) return null;
        return {
          grid: els.map((el) => digitOf(el.dataset.value)),
          given: els.map((el) => el.classList.contains('fixed')),
          notes: els.map((el) => (digitOf(el.dataset.value) ? [] : [...el.querySelectorAll('.annotation')]
            .filter((n) => getComputedStyle(n).visibility === 'visible').map((n) => digitOf(n.textContent)).filter(Boolean))),
        };
      },
      async put(i, d) {
        const el = this.cells()[i];
        pointer(el);
        await sleep(10);
        key(el, d ? String(d) : 'Backspace');
      },
      // Notes mode (the Notes button), where each digit typed toggles that note
      async setNotes(target) {
        const st = this.read(), btn = document.getElementById('notes');
        if (!st || !btn) throw new Error('no notes button');
        const on = () => { const s = document.getElementById('notes-on'); return !!s && getComputedStyle(s).display !== 'none'; };
        const was = on();
        if (!was) { btn.click(); await sleep(30); }
        try {
          const els = this.cells();
          for (let i = 0; i < 81; i++) {
            if (st.grid[i]) continue;
            const have = new Set(st.notes[i]), want = new Set(target[i]);
            const flip = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => have.has(d) !== want.has(d));
            if (!flip.length) continue;
            pointer(els[i]); await sleep(8);
            for (const d of flip) { key(els[i], String(d)); await sleep(8); }
          }
        } finally { if (!was && on()) { btn.click(); await sleep(20); } }
      },
    },
  ];

  const findAdapter = () => ADAPTERS.find((a) => { try { return a.match(); } catch (e) { return false; } }) || null;
  const api = { ADAPTERS, findAdapter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SDKH_SITES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
