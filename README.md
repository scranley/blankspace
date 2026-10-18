# SwiftBlock

A Manifest V3 Chrome extension that hides Taylor Swift–related mentions from web pages using keyword filtering.

Modeled on **[KardBlock](https://github.com/JamesShamsi/KardBlock)** by James Shamsi (2015), which stripped Kardashian–Jenner content from pages the same way: scan the DOM for known names/aliases and hide the surrounding feed/article/card nodes.

## What it does

- Runs a content script on http(s) pages
- Matches configurable keywords and aliases (Taylor Swift, T-Swift, Eras Tour, distinctive album/song titles, and more)
- Hides the nearest sensible container (article, list item, feed card, YouTube result row) instead of blanking the whole page
- Watches dynamic content with a `MutationObserver` so infinite scrolls and SPA feeds keep getting filtered
- Popup: on/off toggle, add/remove keywords, reset to defaults — persisted with `chrome.storage.sync`

No accounts, backends, or site-specific APIs.

## Install (Load unpacked)

1. Clone or download this repo.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select this project folder (the one that contains `manifest.json`).
6. Pin **SwiftBlock** from the puzzle-piece menu if you want quick access to the popup.

Edit keywords anytime from the toolbar popup. Changes apply to open tabs as soon as storage updates (refresh a tab if a page was already fully rendered before install).

## Default keywords (summary)

Includes distinctive name/alias forms and culture hooks such as:

- **Names / fans:** Taylor Swift, Tay Swift, TaySwift, T-Swift, T Swift, Swiftie, Swifties
- **Tours / media:** Eras Tour, Reputation Stadium Tour, Miss Americana
- **Catalog signals:** Taylor's Version, Midnights, Folklore, Evermore, The Tortured Poets Department / TTPD, and distinctive song titles (Anti-Hero, Shake It Off, Blank Space, Cruel Summer, All Too Well, …)

Ambiguous one-word titles like bare “Red” or “Karma” are left out of the defaults to limit false positives — add them yourself if you want stricter filtering.

## Try the demo page

After loading the extension, open `demo/sample-feed.html` (via any local static server, or as a `file://` URL). Cards mentioning Taylor Swift / Eras Tour / Anti-Hero should disappear; unrelated news stays.

## Project layout

```
manifest.json          Chrome MV3 manifest
background.js          Seeds default settings on install
content/filter.js      DOM scan + MutationObserver hiding
popup/                 Toggle + keyword editor UI
shared/defaults.js     Shared default keyword list
icons/                 Extension icons
demo/                  Sample feed for local smoke-testing
```

## Privacy

Settings stay in Chrome sync storage on your profile. The extension does not send browsing data anywhere.

## Changelog

### 1.0.0

- Initial release: Manifest V3 keyword filter for Taylor Swift–related mentions
- Content script + MutationObserver; popup on/off toggle and editable keyword list (`chrome.storage.sync`)
- Sensible defaults (names, aliases, Eras Tour, Taylor’s Version, distinctive titles)

## License

MIT — free to use, modify, and redistribute.
