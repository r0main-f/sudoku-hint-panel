# Sudoku Hint Panel — notes for working on this repo

## Code layout
- `extension/engine.js` — the solver, for any grid size (`createSudokuEngine(boxRows, boxCols)`); no DOM.
- `extension/content.js` — sudoku.com: reads the game, draws the panel and overlay, uses the engine as 9×9.
- `extension/page-bridge.js` — runs in the page; signals saves and newly loaded puzzles.
- `extension/explain.js` — what each hint says and the assist order (`createExplainer(engine)`); no DOM.
- `extension/solver.html|js|css` + `solver-worker.js` — the "any grid" page (4×4 … 16×16), opened by the toolbar button (`background.js`).

## Tests — run before every commit that touches the engine
`node tests/run.js`: the 9×9 continuity fingerprints (`tests/golden-9x9.js` for the engine,
`tests/explain-9x9.js` for hint texts and assist order) and all grid sizes (`tests/sizes.js`). If a fingerprint changes on purpose, re-record with
`node tests/golden-9x9.js --update` and say why in the commit.

## Every release (any version bump in `extension/manifest.json`)
Bumping the version makes `.github/workflows/release.yml` create the GitHub
release and submit the zip to the Chrome Web Store, so get these ready first:

1. **Update the store screenshots and marquee** so they show the current panel:
   `store/screenshot-1…5-*.png` (1280×800) and `store/marquee-promo-1400x560.png`.
   Regenerate them from the current `extension/` code with `python3 store/tools/screenshots.py`
   (Playwright + Chromium) — never ship a release with screenshots from an older version.
   Screenshot 4 is the "any grid" page; the others show the sudoku.com panel.
2. `node tests/run.js` must pass.
3. Add the `## x.y.z` section to `CHANGELOG.md` (it becomes the release notes).
4. Update `README.md` and `store/listing-en.md` / `listing-fr.md` if features changed.
5. Copy the new zip, screenshots and an updated COPY-PASTE-SHEET.txt to the
   owner's `~/Downloads/Sudoku-Hint-Panel-Store` folder, since the store listing
   images are uploaded by hand.
6. Only then bump the version — and only when the owner asks for the release.
