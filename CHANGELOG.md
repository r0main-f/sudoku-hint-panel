# Changelog

Each `## x.y.z` section below becomes the notes of the GitHub release `vx.y.z`
(see `.github/workflows/release.yml`). Add a section here before bumping the
version in `extension/manifest.json`.

## 4.2.0

- **Difficulty badge in the title bar**, on sudoku.com's own scale: 1–2 Easy · 3–4 Medium · 5–6 Hard · 7–8 Expert · 9–10 Extreme. It weighs the work left to finish the grid (always taking the easiest step) and the hardest technique needed, calibrated on about 130 sudoku.com puzzles; forcing chains or beyond is 10/10. It goes down as you fill the grid, reads 0/10 once solved, and its tooltip names the matching level and the hardest technique. Not shown on Killer puzzles.
- Fix: after switching difficulty in the page (Easy → Medium…), the panel kept the previous grid or stayed faded. It now follows the grid on screen, and an invisible layer over the board no longer hides it.

## 4.1.0

The first public release with every technique, and a panel laid out by how much help you want.

**The panel, from the least help to the most**
- **1 · Notes** — ✎ Candidates fills every empty cell's notes; ✎ Optimized fills them already narrowed by pairs, triples, pointing and chains. No answers given.
- **2 · Step by step assist** — 🧭 Assist always shows the easiest hint left: where to look, then what, then why, drawn on the grid. It moves on once you apply it; Skip jumps ahead; pairs you have already noted are skipped. ☝ ONE single shows one next move.
- **3 · Fill in** — ⚡ Fill singles, and 🏁 Finish grid (types the solution, after a second click).
- **4 · Advanced** — folded by default: how many hints of each technique exist, shown on the grid on demand, with the reasoning on hover.

**Techniques, from the simplest**
- Single option · Pointing (both directions, incl. claiming) · Pairs & triples (naked and hidden) · Chains (coloring).
- Expert techniques, folded away: quads, X-wing & fish (swordfish, jellyfish), wings (XY, XYZ, W), unique rectangles, long chains (X- and XY-chains) and forcing chains.
- A harder technique is only used when everything simpler finds nothing.

**Also**
- A note erased by mistake is detected and shown, instead of producing a wrong hint.
- Each single gets its simplest explanation; hint cells show only the digits possible in them.
- The panel goes quiet when no game is on screen, and draws on cells partly outside the window.

## 3.0.0

First release on the Chrome Web Store: hint panel for sudoku.com with candidates, single options, pairs & triples and pointing, live updates, a movable panel, special editions and the daily challenge.
