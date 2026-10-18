import { DEFAULT_SETTINGS, STORAGE_KEYS } from "./shared/defaults.js";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.keywords
  ]);

  const patch = {};
  if (existing[STORAGE_KEYS.enabled] === undefined) {
    patch[STORAGE_KEYS.enabled] = DEFAULT_SETTINGS.enabled;
  }
  if (!Array.isArray(existing[STORAGE_KEYS.keywords])) {
    patch[STORAGE_KEYS.keywords] = [...DEFAULT_SETTINGS.keywords];
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.sync.set(patch);
  }
});
