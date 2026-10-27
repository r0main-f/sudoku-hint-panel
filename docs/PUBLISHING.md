# Publishing checklist — Sudoku Hint Panel

Everything below is ready in this repository; the account, the fee and the final click are yours.

## 1. Publish the source (GitHub)
Done: https://github.com/r0main-f/sudoku-hint-panel
- Privacy policy URL: https://github.com/r0main-f/sudoku-hint-panel/blob/main/PRIVACY.md
- Support URL: https://github.com/r0main-f/sudoku-hint-panel/issues

## 2. Developer account (once)
1. Go to the Chrome Web Store Developer Dashboard and sign in with the Google account you want to publish under.
2. Accept the developer agreement and pay the one-time registration fee.
3. Set the publisher name (shown on the listing) and a contact email; verify the email.
4. If asked, enable 2-Step Verification on the account, and declare your status: for a free hobby project you are normally a **non-trader**.

## 3. New item
1. **Add new item** → upload `sudoku-hint-panel-3.0.1.zip` (the zip contains only the `extension/` files, manifest at its root).

## 4. Store listing tab
- **Description:** paste the English description from `store/listing-en.md`. The summary comes from the manifest (`description`).
- **Category:** Games (or Education).
- **Language:** English. Then add **French** and paste `store/listing-fr.md`.
- **Graphics:** store icon = `store/store-icon-128.png` (128×128, 96 px artwork with transparent padding); upload the three `store/screenshot-*.png` (1280×800) and `store/promo-tile-440x280.png` as the small promo tile, and `store/marquee-promo-1400x560.png` as the marquee (large) promo tile.
- **Additional fields:** homepage URL = GitHub repository; support URL = the repository's Issues page.

## 5. Privacy tab
Copy the answers from `store/privacy-and-review-answers.md`: single purpose, host-permission justification, **no remote code**, no data types ticked, the three certifications, and the privacy policy URL (`PRIVACY.md` on GitHub).

## 6. Distribution tab
- **Payments:** free.
- **Visibility:** Public (or Unlisted first, to test the store version yourself).
- **Regions:** all.

## 7. Submit for review
Review usually takes from a few days up to a few weeks. If a reviewer asks about access to sudoku.com or the page script, the answers are in `store/privacy-and-review-answers.md`.

## Updating later
Bump `version` in `extension/manifest.json`, zip the `extension/` folder again, then **Package → Upload new package** in the dashboard and submit.
