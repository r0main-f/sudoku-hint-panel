# Sudoku Hint Panel — notes for working on this repo

## Every release (any version bump in `extension/manifest.json`)
Bumping the version makes `.github/workflows/release.yml` create the GitHub
release and submit the zip to the Chrome Web Store, so get these ready first:

1. **Update the store screenshots and marquee** so they show the current panel:
   `store/screenshot-1…5-*.png` (1280×800) and `store/marquee-promo-1400x560.png`.
   Regenerate them from the current `extension/` code — never ship a release
   with screenshots from an older version.
2. Add the `## x.y.z` section to `CHANGELOG.md` (it becomes the release notes).
3. Update `README.md` and `store/listing-en.md` / `listing-fr.md` if features changed.
4. Copy the new zip, screenshots and an updated COPY-PASTE-SHEET.txt to the
   owner's `~/Downloads/Sudoku-Hint-Panel-Store` folder, since the store listing
   images are uploaded by hand.
5. Only then bump the version — and only when the owner asks for the release.
