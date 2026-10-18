# SwiftBlock 1.0.0

Free, open-source Chrome extension (Manifest V3) that hides Taylor Swift–related mentions from web pages using keyword filtering.

Inspired by **[KardBlock](https://github.com/JamesShamsi/KardBlock)** (James Shamsi, 2015).

**License:** MIT

## Install from the release zip

1. Download `swiftblock-1.0.0.zip` from the GitHub Release (or from `dist\swiftblock-1.0.0.zip` in this repo).
2. Unzip it. You should get a folder named `swiftblock-1.0.0` that contains `manifest.json`.
3. Open Chrome → `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select the `swiftblock-1.0.0` folder.
6. Optional: pin **SwiftBlock** from the extensions menu.

## What’s in 1.0.0

- On/off toggle and editable keywords (`chrome.storage.sync`)
- Defaults for names/aliases, Eras Tour, Taylor’s Version, and distinctive titles
- DOM scan + `MutationObserver` for typical news/feed/YouTube-style layouts

## Publish this release (after `main` is on GitHub)

From the `blankspace` folder on this machine (with `gh` authenticated):

```powershell
gh release create v1.0.0 `
  .\dist\swiftblock-1.0.0.zip `
  --repo scranley/blankspace `
  --title "SwiftBlock 1.0.0" `
  --notes-file .\RELEASE_NOTES.md
```
