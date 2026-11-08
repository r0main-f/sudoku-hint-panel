# Answers for the "Privacy practices" tab of the Developer Dashboard

## Single purpose (required)
Shows sudoku solving hints (candidates, single options, pairs/triples, pointing, chains and harder techniques, one at a time or all at once) in a panel on sudoku.com puzzle pages — and, from the toolbar button, on any grid the player pastes or types (4×4 to 16×16) — so players can learn techniques at the level of help they choose.

## Permission justification
The extension requests no API permissions. It declares content scripts for `https://sudoku.com/*` and `https://www.sudoku.com/*`, a toolbar button, and a small background script whose only job is to open the extension's own "any grid" page when that button is clicked.

- **Host access to sudoku.com** — needed to read the current puzzle (which the site keeps in the page's local storage and loads from its own API), to draw the hint overlay on the grid, and to type notes or digits when the player clicks "Candidates", "Optimized", "Fill singles" or "Finish grid". No other site is accessed.
- **Main-world script (`page-bridge.js`)** — runs in the page to notice the moment the game saves a move or loads a new puzzle, so hints update live. It reads data only; it does not send anything anywhere.

## Remote code
**No, I am not using remote code.** All JavaScript is packaged in the extension; nothing is downloaded or evaluated at runtime.

## Data usage
Tick **none** of the data types (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity, website content).

The extension reads the puzzle state on sudoku.com locally to compute hints. That data never leaves the browser and is not stored by the extension. The only things it stores (in the page's localStorage) are panel settings: its position, collapsed state, and whether the welcome note was dismissed.

## Certifications (tick all three)
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL
Not required when no user data is collected, but providing one helps: https://github.com/r0main-f/sudoku-hint-panel/blob/main/PRIVACY.md
