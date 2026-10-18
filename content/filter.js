import { DEFAULT_KEYWORDS, STORAGE_KEYS } from "../shared/defaults.js";

const HIDDEN_ATTR = "data-swiftblock-hidden";
const STYLE_ID = "swiftblock-style";

/** @type {boolean} */
let enabled = true;
/** @type {RegExp | null} */
let matcher = null;
/** @type {MutationObserver | null} */
let observer = null;
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
  "IFRAME"
]);

const ROOT_TAGS = new Set(["HTML", "BODY", "MAIN", "HEAD"]);

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

  const attrBits = [
    el.getAttribute("aria-label"),
    el.getAttribute("alt"),
    el.getAttribute("title")
  ]
    .filter(Boolean)
    .join(" ");

  return `${el.innerText || el.textContent || ""} ${attrBits}`.replace(/\s+/g, " ").trim();
}

function scoreCandidate(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return -1;
  if (ROOT_TAGS.has(el.tagName)) return -1;
  if (el === document.documentElement || el === document.body) return -1;

  let score = 0;
  const tag = el.tagName;
  const role = (el.getAttribute("role") || "").toLowerCase();
  const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";

  if (tag === "ARTICLE") score += 40;
  if (tag === "LI") score += 28;
  if (tag === "TR") score += 20;
  if (role === "article" || role === "listitem") score += 35;
  if (role === "row") score += 18;

  if (/(tweet|post|status|feed|card|story|result|entry|item|video|ytd-|rich-item)/i.test(cls)) {
    score += 22;
  }
  if (/(headline|title|snippet)/i.test(cls)) score += 8;

  const textLen = (el.innerText || "").length;
  if (textLen > 40 && textLen < 4000) score += 15;
  if (textLen >= 4000) score -= 25;
  if (textLen < 20) score -= 10;

  if (tag === "NAV" || role === "navigation" || role === "banner") score -= 50;
  if (el.closest?.("nav, [role='navigation'], header[role='banner']") && tag !== "ARTICLE") {
    score -= 20;
  }

  return score;
}

function findHideTarget(startEl) {
  let best = null;
  let bestScore = 0;
  let el = startEl;

  for (let depth = 0; el && depth < 12; depth += 1) {
    if (el.nodeType === Node.ELEMENT_NODE) {
      const score = scoreCandidate(el);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    el = el.parentElement;
  }

  if (best && bestScore >= 20) return best;
  return startEl.nodeType === Node.ELEMENT_NODE ? startEl : startEl.parentElement;
}

function hideElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
  if (ROOT_TAGS.has(el.tagName)) return;
  if (el.getAttribute(HIDDEN_ATTR) === "1") return;
  el.setAttribute(HIDDEN_ATTR, "1");
}

function unhideAll() {
  document.querySelectorAll(`[${HIDDEN_ATTR}="1"]`).forEach((el) => {
    el.removeAttribute(HIDDEN_ATTR);
  });
}

function scanNode(root) {
  if (!enabled || !matcher) return;
  if (!root || (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE)) {
    return;
  }

  ensureStyle();

  const scope =
    root.nodeType === Node.DOCUMENT_NODE ? root.body || root.documentElement : root;
  if (!scope || SKIP_TAGS.has(scope.tagName)) return;

  /** @type {Element[]} */
  const candidates = [];

  const selector =
    "article, [role='article'], [role='listitem'], li, ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer";
  try {
    scope.querySelectorAll?.(selector)?.forEach((el) => candidates.push(el));
  } catch {
    // ignore selector errors
  }

  if (scope.matches) {
    candidates.push(scope);
  }

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof Element)) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
      if (node.getAttribute(HIDDEN_ATTR) === "1") return NodeFilter.FILTER_REJECT;
      if (node.children.length > 8) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let node = walker.currentNode;
  let budget = 2500;
  while (node && budget > 0) {
    if (node instanceof Element) candidates.push(node);
    node = walker.nextNode();
    budget -= 1;
  }

  const seen = new Set();
  for (const el of candidates) {
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.getAttribute?.(HIDDEN_ATTR) === "1") continue;

    const text = collectText(el);
    if (!textMatches(text)) continue;

    const target = findHideTarget(el);
    if (target) hideElement(target);
  }
}

function queueScan(root = document) {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    scanNode(root);
  });
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    if (!enabled || !matcher) return;
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === Node.ELEMENT_NODE) {
          queueScan(added);
        } else if (added.nodeType === Node.TEXT_NODE && added.parentElement) {
          queueScan(added.parentElement);
        }
      }
      if (mutation.type === "characterData" && mutation.target?.parentElement) {
        queueScan(mutation.target.parentElement);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
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
  await loadSettings();
  unhideAll();
  if (!enabled || !matcher) {
    stopObserver();
    return;
  }
  ensureStyle();
  scanNode(document);
  startObserver();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes[STORAGE_KEYS.enabled] || changes[STORAGE_KEYS.keywords]) {
    applySettings();
  }
});

applySettings();
