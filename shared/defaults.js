/**
 * Shared defaults for SwiftBlock (classic script — no export/import).
 * Loaded before content/filter.js, popup.js, and via importScripts in background.
 */
(function (global) {
  "use strict";

  /** @type {string[]} */
  const DEFAULT_KEYWORDS = [
    "Taylor Swift",
    "Tay Swift",
    "TaySwift",
    "T-Swift",
    "T Swift",
    "Swiftie",
    "Swifties",
    "Eras Tour",
    "The Eras Tour",
    "Miss Americana",
    "Reputation Stadium Tour",
    "Taylor's Version",
    "The Tortured Poets Department",
    "TTPD",
    "The Life of a Showgirl",
    "Fearless (Taylor's Version)",
    "Speak Now (Taylor's Version)",
    "Red (Taylor's Version)",
    "1989 (Taylor's Version)",
    "Midnights",
    "Folklore",
    "Evermore",
    "Anti-Hero",
    "Shake It Off",
    "Blank Space",
    "Cruel Summer",
    "All Too Well",
    "Look What You Made Me Do",
    "You Belong With Me",
    "Bad Blood",
    "Lavender Haze",
    "Bejeweled",
    "Fortnight",
    "Cardigan",
    "Willow",
    "Delicate"
  ];

  const STORAGE_KEYS = {
    enabled: "enabled",
    keywords: "keywords"
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    keywords: DEFAULT_KEYWORDS
  };

  global.SWIFTBLOCK_DEFAULTS = {
    DEFAULT_KEYWORDS,
    STORAGE_KEYS,
    DEFAULT_SETTINGS
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
