// Sudoku Hint Panel — the toolbar button opens the "any grid" page.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('solver.html') });
});
