/* global SWIFTBLOCK_DEFAULTS */
const { DEFAULT_KEYWORDS, STORAGE_KEYS } = globalThis.SWIFTBLOCK_DEFAULTS;
const HIDDEN_ATTR = "data-swiftblock-hidden";
const STYLE_ID = "swiftblock-style";

/** @type {boolean} */
let enabled = true;
/** @type {RegExp | null} */
let matcher = null;
/** @type {MutationObserver | null} */
let observer = null;
/** @type {Set<Node>} */
const pendingRoots = new Set();
let scanQueued = false;

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "SVG",
  "PATH",
  "META",
  "LINK",
  "HEAD",
  "FORM"
]);

const ROOT_TAGS = new Set(["HTML", "BODY", "MAIN", "HEAD"]);

/**
 * Small, card-sized result units only.
 * Google News story card around a.JtKRv is typically c-wiz.XBspb (prefer over PO9Zff).
 * Never include Home section shells (zQTmif / mtd78e / XCcFNb) — see NEWS_SECTION_DENY.
 */
const CARD_SELECTOR = [
  "div.g",
  "div.tF2Cxc",
  "div.N54PNb",
  "div.kp-wholepage",
  "div.knowledge-panel",
  "block-component",
  "g-card",
  "g-inner-card",
  "div.related-question-pair",
  "video-voyager",
  // Google News — single story card (Home + Search)
  "c-wiz.XBspb",
  "c-wiz.PO9Zff",
  "article",
  "[role='article']",
  // Google News sidebar topic hero (small)
  "div.bfSRxb",
  "div.W8tbQ",
  "li.b_algo",
  "li.b_ans",
  "ytd-video-renderer",
  "ytd-rich-item-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-renderer",
  "ytd-channel-renderer",
  "ytd-search-pyv-renderer"
].join(", ");

/** Google News Home / briefing shells — never hide these class tokens. */
const NEWS_SECTION_DENY_CLASSES = [
  "zQTmif", // whole-page / briefing shell
  "SSPGKf", // paired with zQTmif on Home
  "mtd78e", // "Your topics" section
  "XCcFNb" // topic section (e.g. Entertainment)
];

/** Match sources that are not themselves hide targets. */
const MATCH_SOURCE_SELECTOR = [
  "a.JtKRv",
  "a.lgHhnc",
  "a[aria-label]",
  "[role='link'][aria-label]",
  "h3",
  "h4"
].join(", ");

/** Autocomplete / suggestion UI — never scan or hide. */
const AUTOCOMPLETE_SELECTOR = [
  "[role='listbox']",
  "[role='option']",
  "[role='combobox']",
  "[role='searchbox']",
  "ul[role='listbox']",
  ".erkvQe",
  ".aajZCb",
  ".UUbT9",
  ".G43f7e",
  ".OBMEnb",
  ".lnnVSe",
  ".sbl1p",
  "#Alh6id",
  "#knfMCf"
].join(", ");

const INTERACTIVE_INSIDE = [
  "input",
  "textarea",
  "form",
  "[role='combobox']",
  "[role='searchbox']",
  "[role='listbox']",
  "[contenteditable='true']"
].join(", ");

const CARD_CHILD_SELECTOR =
  "article, c-wiz.XBspb, c-wiz.PO9Zff, div.g, div.tF2Cxc, g-card, li.b_algo, ytd-video-renderer, ytd-rich-item-renderer";

const PROTECT_SELECTOR = [
  "html",
  "body",
  "main",
  "header",
  "nav",
  "[role='search']",
  "[role='navigation']",
  "[role='banner']",
  "form",
  "input",
  "textarea",
  "[role='combobox']",
  "[role='searchbox']",
  "[role='listbox']",
  "#searchform",
  ".RNNXgb",
  ".aajZCb",
  ".erkvQe",
  "#tsf",
  "#search",
  "#rso",
  "#center_col",
  "#main",
  "#rcnt",
  "#b_content",
  "#b_results",
  "ytd-app",
  "ytd-page-manager"
].join(", ");

const MAX_VIEWPORT_FRACTION = 0.4;
/** More than one story/card inside ⇒ section wrapper, never hide. */
const MAX_CARD_CHILDREN = 1;

const HEADLINE_LINK_SELECTOR =
  'a.JtKRv, a[href*="./read/"], a[href*="/articles/"], a[href*="/read/"], article a[href], c-wiz.XBspb a[href], c-wiz.PO9Zff a[href]';

/** Refuse shells that contain this many raw anchors (multi-story groups). */
const MAX_RAW_LINKS = 5;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [${HIDDEN_ATTR}="1"] {
      display: none !important;
    }
  `;
  (document.documentElement || document.head || document.body).appendChild(style);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(keywords) {
  const cleaned = (keywords || [])
    .map((k) => String(k || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (cleaned.length === 0) return null;

  const bodies = cleaned.map((keyword) =>
    escapeRegExp(keyword).replace(/\s+/g, "\\s+")
  );

  try {
    return new RegExp(`(?<![\\w])(?:${bodies.join("|")})(?![\\w])`, "i");
  } catch {
    return new RegExp(`(?:${bodies.join("|")})`, "i");
  }
}

function textMatches(text) {
  if (!matcher || !text) return false;
  return matcher.test(text);
}

function collectText(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
  if (SKIP_TAGS.has(el.tagName)) return "";
  if (el.getAttribute?.(HIDDEN_ATTR) === "1") return "";

  const bits = [
    el.innerText || el.textContent || "",
    el.getAttribute("aria-label"),
    el.getAttribute("alt"),
    el.getAttribute("title")
  ];

  try {
    el.querySelectorAll?.(MATCH_SOURCE_SELECTOR)?.forEach((node) => {
      bits.push(
        node.getAttribute("aria-label"),
        node.getAttribute("alt"),
        node.getAttribute("title"),
        node.innerText || node.textContent || ""
      );
    });
  } catch {
    // ignore
  }

  return bits.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function classTokens(el) {
  const cls = typeof el.className === "string" ? el.className : "";
  return cls.split(/\s+/).filter(Boolean);
}

function isNewsSectionShell(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const tokens = classTokens(el);
  return NEWS_SECTION_DENY_CLASSES.some((deny) => tokens.includes(deny));
}

function isProtected(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  if (ROOT_TAGS.has(el.tagName)) return true;
  if (el === document.documentElement || el === document.body) return true;
  if (isNewsSectionShell(el)) return true;
  try {
    if (el.matches?.(PROTECT_SELECTOR)) return true;
    if (el.matches?.(AUTOCOMPLETE_SELECTOR)) return true;
    if (el.closest?.(AUTOCOMPLETE_SELECTOR)) return true;
  } catch {
    // ignore
  }
  return false;
}

/** Page query chrome: search heading / title that only echoes the query. */
function isQueryChrome(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = el.tagName;
  if (tag === "TITLE") return true;
  if (tag === "H1" || tag === "H2") {
    // Google SERP / News often put the query in a top heading.
    if (el.closest?.("#searchform, form, [role='search'], header, nav")) return true;
  }
  try {
    if (el.matches?.("#logo, .logo, [data-attrid='title']")) return true;
  } catch {
    // ignore
  }
  return false;
}

function containsInteractiveOrFocus(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  try {
    if (el.matches?.(INTERACTIVE_INSIDE)) return true;
    if (el.querySelector?.(INTERACTIVE_INSIDE)) return true;
  } catch {
    return true;
  }
  const active = document.activeElement;
  if (active && el !== active && el.contains(active)) return true;
  return false;
}

function viewportArea() {
  const w = window.innerWidth || document.documentElement.clientWidth || 1;
  const h = window.innerHeight || document.documentElement.clientHeight || 1;
  return Math.max(1, w * h);
}

/**
 * @returns {number} area in px², or -1 if unmeasurable / zero (treat as unsafe).
 */
function elementArea(el) {
  try {
    const r = el.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    // Fail closed: lazy/hidden/pre-layout nodes report 0×0 and must not be hidden
    // (a huge section wrapper often measures 0 until laid out).
    if (!(area > 0) || !Number.isFinite(area)) return -1;
    return area;
  } catch {
    return -1;
  }
}

function countCardChildren(el) {
  try {
    // Count descendant cards only (not the element itself if it matches).
    const all = el.querySelectorAll?.(CARD_CHILD_SELECTOR);
    if (!all) return 0;
    let n = 0;
    all.forEach((node) => {
      if (node !== el) n += 1;
    });
    return n;
  } catch {
    return 99;
  }
}

/** Known single-story News cards — may measure 0×0 before layout; exempt from area fail-closed. */
function isKnownSingleStoryCard(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (isNewsSectionShell(el)) return false;
  try {
    return !!el.matches?.(
      "c-wiz.XBspb, c-wiz.PO9Zff, article, [role='article'], div.bfSRxb, div.W8tbQ"
    );
  } catch {
    return false;
  }
}

/** Normalize article URLs so image+headline links to the same story count once. */
function normalizeArticleHref(href) {
  if (!href) return "";
  try {
    const u = new URL(href, document.baseURI || location.href);
    // Keep path only; Google News ./read/IDs live in the path.
    return (u.pathname || "").replace(/\/+$/, "") || href.split("#")[0].split("?")[0];
  } catch {
    return String(href).split("#")[0].split("?")[0];
  }
}

/**
 * Google News article links only (for distinct-story counting).
 * Image + headline often share one ./read/ id; ignore ./publications, More, topics.
 */
function isArticleStoryLink(a) {
  if (!a || a.tagName !== "A") return false;
  const href = (a.getAttribute("href") || "").toLowerCase();
  if (!href || href === "#" || href.startsWith("javascript:")) return false;
  if (/\/publications?\//.test(href)) return false;
  if (/\/topics?\//.test(href)) return false;

  const label = `${a.getAttribute("aria-label") || ""} ${a.innerText || ""}`
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (label === "more" || label === "follow" || label === "share" || label === "menu") {
    return false;
  }

  if (a.classList?.contains("JtKRv") || a.classList?.contains("lgHhnc")) return true;
  if (/\/read\//.test(href) || /\/articles?\//.test(href)) return true;
  return false;
}

/**
 * Count distinct *article* destinations (not publisher/More links).
 * Image + headline to the same ./read/ id ⇒ 1.
 */
function countDistinctArticleHrefs(el) {
  try {
    const links = el.querySelectorAll?.("a[href]");
    if (!links || links.length === 0) return 0;
    const seen = new Set();
    links.forEach((a) => {
      if (!isArticleStoryLink(a)) return;
      const key = normalizeArticleHref(a.getAttribute("href") || "");
      if (key) seen.add(key);
    });
    return seen.size;
  } catch {
    return 99;
  }
}

function countRawAnchors(el) {
  try {
    return el.querySelectorAll?.("a[href]")?.length || 0;
  } catch {
    return 99;
  }
}

function isDebug() {
  try {
    return localStorage.getItem("swiftblockDebug") === "1";
  } catch {
    return false;
  }
}

function describeEl(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return String(el);
  const cls = typeof el.className === "string" ? el.className.trim().replace(/\s+/g, ".") : "";
  return `${el.tagName}${cls ? "." + cls.split(".").slice(0, 3).join(".") : ""}`;
}

/** Why a candidate must not be hidden (for debug logs). */
function refuseReason(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return "not-element";
  if (el === document.documentElement || el === document.body) return "page-shell";
  if (el.tagName === "HTML" || el.tagName === "BODY" || el.tagName === "MAIN") return "page-shell";
  if (isNewsSectionShell(el)) return "news-section-shell";
  if (isProtected(el)) return "protected";
  if (isQueryChrome(el)) return "query-chrome";
  try {
    if (el.closest?.(AUTOCOMPLETE_SELECTOR)) return "autocomplete";
  } catch {
    // ignore
  }
  if (containsInteractiveOrFocus(el)) return "interactive-or-focus";
  const cards = countCardChildren(el);
  if (cards > MAX_CARD_CHILDREN) return `card-children=${cards}`;
  const articles = countDistinctArticleHrefs(el);
  if (articles > 1) return `distinct-article-hrefs=${articles}`;
  const raw = countRawAnchors(el);
  if (raw > MAX_RAW_LINKS) return `raw-links=${raw}`;
  const area = elementArea(el);
  if (area < 0 && !isKnownSingleStoryCard(el)) return "area-unmeasurable";
  if (area >= 0 && area / viewportArea() > MAX_VIEWPORT_FRACTION) {
    return `area-fraction=${(area / viewportArea()).toFixed(2)}`;
  }
  if ((el.innerText || "").length > 6000) return "text-too-long";
  return null;
}

function isTooLarge(el) {
  if (!el) return true;
  // Always refuse Home / briefing section shells.
  if (isNewsSectionShell(el)) return true;

  // Multi-story checks first (independent of layout).
  if (countCardChildren(el) > MAX_CARD_CHILDREN) return true;
  // Only *article* hrefs — publisher/More must not inflate this.
  if (countDistinctArticleHrefs(el) > 1) return true;
  // Multi-story groups typically have 6+ anchors; single cards stay under that.
  if (countRawAnchors(el) > MAX_RAW_LINKS) return true;

  const area = elementArea(el);
  const knownCard = isKnownSingleStoryCard(el);
  // Zero / unmeasurable: fail closed for unknown shells; allow known single-story cards.
  if (area < 0) {
    return !knownCard;
  }
  const frac = area / viewportArea();
  if (frac > MAX_VIEWPORT_FRACTION) return true;
  const textLen = (el.innerText || "").length;
  if (textLen > 6000) return true;
  return false;
}

function isSafeHideTarget(el) {
  return refuseReason(el) === null;
}

/**
 * Prefer the smallest safe card containing the match.
 * If a candidate is too big, walk down to a card child that still contains the match.
 */
function shrinkToSafeCard(candidate, matchEl) {
  if (!candidate) return null;
  if (isSafeHideTarget(candidate)) return candidate;

  try {
    const cards = candidate.querySelectorAll?.(CARD_SELECTOR);
    if (cards && cards.length) {
      /** @type {Element | null} */
      let best = null;
      let bestArea = Infinity;
      cards.forEach((card) => {
        if (!matchEl || !card.contains(matchEl)) {
          // If matchEl is the candidate itself, any matching card is ok if text matches.
          if (matchEl && matchEl !== candidate && !card.contains(matchEl)) return;
        }
        if (!isSafeHideTarget(card)) return;
        if (!textMatches(collectText(card))) return;
        const area = elementArea(card);
        // Prefer measurable cards; allow known single-story cards with 0 area as last resort.
        if (area < 0 && !isKnownSingleStoryCard(card)) return;
        const sortArea = area < 0 ? Number.MAX_SAFE_INTEGER - 1 : area;
        if (sortArea < bestArea) {
          bestArea = sortArea;
          best = card;
        }
      });
      if (best) return best;
    }
  } catch {
    // ignore
  }

  // Walk up from the match looking for a safe card only.
  let el = matchEl;
  for (let i = 0; el && i < 12; i += 1) {
    try {
      if (el.matches?.(CARD_SELECTOR) && isSafeHideTarget(el)) return el;
    } catch {
      // ignore
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Site-agnostic: walk up from the match; keep the largest ancestor that still
 * has ≤1 distinct story link and passes safety. Stop before multi-story shells.
 */
function findGenericOneStoryTarget(origin) {
  /** @type {Element | null} */
  let best = null;
  let el = origin;
  for (let depth = 0; el && depth < 16; depth += 1) {
    if (el === document.documentElement || el === document.body) break;
    if (el.tagName === "HTML" || el.tagName === "BODY" || el.tagName === "MAIN") break;
    if (isNewsSectionShell(el) || isProtected(el) || isQueryChrome(el)) break;
    try {
      if (el.closest?.(AUTOCOMPLETE_SELECTOR) === el) break;
    } catch {
      // ignore
    }

    const articles = countDistinctArticleHrefs(el);
    // Entering a multi-story container — stop; use previous best.
    if (articles > 1) break;
    if (countRawAnchors(el) > MAX_RAW_LINKS) break;

    if (isSafeHideTarget(el)) {
      best = el;
    } else {
      // Still climb if only issue is being an <a>; otherwise stop when unsafe for other reasons.
      if (el.tagName !== "A") {
        const why = refuseReason(el);
        if (why && why !== "interactive-or-focus") {
          // interactive check is noisy for cards with buttons; soft-continue only for anchors above.
        }
      }
    }
    el = el.parentElement;
  }
  return best;
}

function findHideTarget(startEl) {
  if (!startEl) return null;

  const origin =
    startEl.nodeType === Node.ELEMENT_NODE ? startEl : startEl.parentElement;
  if (!origin || isProtected(origin) || isQueryChrome(origin)) return null;
  if (isNewsSectionShell(origin)) return null;

  try {
    if (origin.closest?.(AUTOCOMPLETE_SELECTOR)) return null;
  } catch {
    // ignore
  }

  try {
    // Google News: prefer nearest single-story c-wiz.XBspb around a.JtKRv.
    const xbspb = origin.closest?.("c-wiz.XBspb");
    if (xbspb && !isNewsSectionShell(xbspb) && isSafeHideTarget(xbspb)) {
      return xbspb;
    }

    // Other known site cards (Google / Bing / YouTube extras).
    const preferred = origin.closest?.(
      "article, c-wiz.PO9Zff, div.g, div.bfSRxb, div.W8tbQ, li.b_algo, ytd-video-renderer, [role='article']"
    );
    if (preferred && !isNewsSectionShell(preferred) && isSafeHideTarget(preferred)) {
      return preferred;
    }
    if (preferred && !isNewsSectionShell(preferred)) {
      const shrunk = shrinkToSafeCard(preferred, origin);
      if (shrunk) return shrunk;
    }
  } catch {
    // ignore
  }

  // Generic one-story ancestor walk (any outlet).
  return findGenericOneStoryTarget(origin);
}

function hideElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
  if (el === document.documentElement || el === document.body) return;
  if (el.tagName === "HTML" || el.tagName === "BODY" || el.tagName === "MAIN") return;
  if (!isSafeHideTarget(el)) return;
  if (el.getAttribute(HIDDEN_ATTR) === "1") return;
  el.setAttribute(HIDDEN_ATTR, "1");
}

function unhideAll() {
  document.querySelectorAll(`[${HIDDEN_ATTR}="1"]`).forEach((el) => {
    el.removeAttribute(HIDDEN_ATTR);
  });
  walkOpenShadows(document.documentElement, (root) => {
    root.querySelectorAll(`[${HIDDEN_ATTR}="1"]`).forEach((el) => {
      el.removeAttribute(HIDDEN_ATTR);
    });
  });
}

/** @param {Element | null} host */
function walkOpenShadows(host, fn) {
  if (!host) return;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ELEMENT);
  /** @type {Element | null} */
  let node = host;
  while (node) {
    if (node.shadowRoot) {
      fn(node.shadowRoot);
      walkOpenShadows(node.shadowRoot.firstElementChild, fn);
    }
    node = /** @type {Element | null} */ (walker.nextNode());
  }
}

/**
 * @param {ParentNode} scope
 * @param {Element[]} candidates
 */
function collectCandidates(scope, candidates) {
  try {
    scope.querySelectorAll?.(CARD_SELECTOR)?.forEach((el) => {
      if (!el.closest?.(AUTOCOMPLETE_SELECTOR)) candidates.push(el);
    });
  } catch {
    // ignore
  }

  try {
    scope.querySelectorAll?.(MATCH_SOURCE_SELECTOR)?.forEach((el) => {
      if (!el.closest?.(AUTOCOMPLETE_SELECTOR)) candidates.push(el);
    });
  } catch {
    // ignore
  }

  // Site-agnostic match sources (any outlet).
  try {
    scope
      .querySelectorAll?.(
        "article, [role='article'], h2, h3, a[href]"
      )
      ?.forEach((el) => {
        if (!el.closest?.(AUTOCOMPLETE_SELECTOR)) candidates.push(el);
      });
  } catch {
    // ignore
  }

  if (!(scope instanceof Element) && !(scope instanceof Document) && !(scope instanceof DocumentFragment) && !(scope instanceof ShadowRoot)) {
    return;
  }

  // Light walker for leftover text nodes in known cards only — avoid whole-page walks.
  try {
    scope.querySelectorAll?.(CARD_SELECTOR)?.forEach((card) => {
      if (card.shadowRoot) collectCandidates(card.shadowRoot, candidates);
    });
  } catch {
    // ignore
  }
}

function scanNode(root) {
  if (!enabled || !matcher) return;
  if (
    !root ||
    (root.nodeType !== Node.ELEMENT_NODE &&
      root.nodeType !== Node.DOCUMENT_NODE &&
      root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE)
  ) {
    return;
  }

  ensureStyle();

  /** @type {ParentNode | null} */
  let scope = null;
  if (root.nodeType === Node.DOCUMENT_NODE) {
    scope = /** @type {Document} */ (root).body || /** @type {Document} */ (root).documentElement;
  } else {
    scope = /** @type {Element} */ (root);
  }
  if (!scope) return;
  if (scope instanceof Element && SKIP_TAGS.has(scope.tagName)) return;
  if (scope instanceof Element && isProtected(scope) && !scope.querySelector?.(CARD_SELECTOR)) {
    return;
  }

  /** @type {Element[]} */
  const candidates = [];
  collectCandidates(scope, candidates);

  const seen = new Set();
  for (const el of candidates) {
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.getAttribute?.(HIDDEN_ATTR) === "1") continue;
    if (isProtected(el) || isQueryChrome(el)) continue;
    try {
      if (el.closest?.(AUTOCOMPLETE_SELECTOR)) continue;
    } catch {
      continue;
    }

    const text = collectText(el);
    if (!textMatches(text)) continue;

    if (isDebug()) {
      const chain = [];
      let p = el;
      for (let i = 0; p && i < 10; i += 1) {
        const why = refuseReason(p);
        const area = elementArea(p);
        chain.push({
          el: describeEl(p),
          refuse: why,
          articleHrefs: countDistinctArticleHrefs(p),
          rawLinks: countRawAnchors(p),
          cards: countCardChildren(p),
          area: area < 0 ? 0 : Math.round(area)
        });
        p = p.parentElement;
      }
      console.info("[SwiftBlock:debug] match", {
        matched: describeEl(el),
        text: text.slice(0, 120),
        chosen: null,
        ancestors: chain
      });
    }

    const target = findHideTarget(el);
    if (isDebug()) {
      console.info("[SwiftBlock:debug] choose", {
        matched: describeEl(el),
        chosen: target ? describeEl(target) : null,
        chosenRefuse: target ? refuseReason(target) : "no-safe-target"
      });
    }
    if (target) hideElement(target);
  }
}

function queueScan(root = document) {
  pendingRoots.add(root || document);
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    if (
      roots.length > 1 ||
      roots.some(
        (r) => r === document || r === document.documentElement || r === document.body
      )
    ) {
      scanNode(document);
      return;
    }
    for (const r of roots) scanNode(r);
  });
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    if (!enabled || !matcher) return;
    let needsFull = false;
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === Node.ELEMENT_NODE) {
          const el = /** @type {Element} */ (added);
          if (
            el.id === "rso" ||
            el.id === "center_col" ||
            el.querySelector?.(
              "c-wiz.PO9Zff, article, div.g, li.b_algo, ytd-video-renderer"
            )
          ) {
            needsFull = true;
          } else if (!el.closest?.(AUTOCOMPLETE_SELECTOR)) {
            queueScan(el);
          }
        } else if (added.nodeType === Node.TEXT_NODE && added.parentElement) {
          if (!added.parentElement.closest?.(AUTOCOMPLETE_SELECTOR)) {
            queueScan(added.parentElement);
          }
        }
      }
      if (mutation.type === "characterData" && mutation.target?.parentElement) {
        if (!mutation.target.parentElement.closest?.(AUTOCOMPLETE_SELECTOR)) {
          queueScan(mutation.target.parentElement);
        }
      }
      if (
        mutation.type === "attributes" &&
        mutation.target instanceof Element &&
        (mutation.attributeName === "aria-label" || mutation.attributeName === "alt")
      ) {
        if (!mutation.target.closest?.(AUTOCOMPLETE_SELECTOR)) {
          queueScan(mutation.target);
        }
      }
    }
    if (needsFull) queueScan(document);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "alt", "title"]
  });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

async function loadSettings() {
  const data = await chrome.storage.sync.get({
    [STORAGE_KEYS.enabled]: true,
    [STORAGE_KEYS.keywords]: [...DEFAULT_KEYWORDS]
  });
  enabled = data[STORAGE_KEYS.enabled] !== false;
  const keywords = Array.isArray(data[STORAGE_KEYS.keywords])
    ? data[STORAGE_KEYS.keywords]
    : [...DEFAULT_KEYWORDS];
  matcher = enabled ? buildMatcher(keywords) : null;
}

async function applySettings() {
  try {
    ensureStyle();
    console.info("[SwiftBlock] content script active", location.href);

    await loadSettings();
    unhideAll();
    if (!enabled || !matcher) {
      stopObserver();
      console.info("[SwiftBlock] idle (disabled or no keywords)");
      return;
    }
    scanNode(document);
    startObserver();
    window.setTimeout(() => scanNode(document), 500);
    window.setTimeout(() => scanNode(document), 2000);
  } catch (err) {
    console.error("[SwiftBlock] applySettings failed", err);
    ensureStyle();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes[STORAGE_KEYS.enabled] || changes[STORAGE_KEYS.keywords]) {
    applySettings();
  }
});

ensureStyle();
console.info("[SwiftBlock] loaded");
applySettings();
