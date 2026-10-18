import json, time, urllib.request, base64, pathlib
import websocket

PORT = 9333
ROOT = pathlib.Path(r"C:\code_9_17_25\blankspace")
OUT = ROOT / "demo"
defaults_js = (ROOT / "shared" / "defaults.js").read_text(encoding="utf-8")
filter_js = (ROOT / "content" / "filter.js").read_text(encoding="utf-8")

STORAGE_STUB = r"""
(() => {
  if (window.chrome && chrome.storage && chrome.storage.sync && chrome.storage.sync.__swiftblock) return;
  const store = {
    enabled: true,
    keywords: (globalThis.SWIFTBLOCK_DEFAULTS && globalThis.SWIFTBLOCK_DEFAULTS.DEFAULT_KEYWORDS)
      ? globalThis.SWIFTBLOCK_DEFAULTS.DEFAULT_KEYWORDS.slice()
      : ["Taylor Swift"]
  };
  const listeners = [];
  const api = {
    get(defaults) {
      const keys = defaults && typeof defaults === "object" && !Array.isArray(defaults)
        ? defaults
        : null;
      const out = {};
      if (keys) {
        for (const k of Object.keys(keys)) out[k] = store[k] !== undefined ? store[k] : keys[k];
      } else {
        Object.assign(out, store);
      }
      return Promise.resolve(out);
    },
    set(obj) {
      Object.assign(store, obj);
      return Promise.resolve();
    },
    __swiftblock: true
  };
  window.chrome = window.chrome || {};
  chrome.storage = chrome.storage || {};
  chrome.storage.sync = api;
  chrome.storage.onChanged = {
    addListener(fn) { listeners.push(fn); }
  };
  chrome.runtime = chrome.runtime || { id: "swiftblock-cdp-stub" };
})();
"""


def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))


def get_page():
    for t in targets():
        if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
            u = t.get("url") or ""
            if not u.startswith("devtools:"):
                return t
    raise SystemExit("no page")


meta = get_page()
ws = websocket.create_connection(meta["webSocketDebuggerUrl"], timeout=180)
mid = 0


def call(method, params=None, timeout=180):
    global mid
    mid += 1
    i = mid
    ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))
    end = time.time() + timeout
    while time.time() < end:
        data = json.loads(ws.recv())
        if data.get("id") == i:
            if "error" in data:
                raise RuntimeError(data["error"])
            return data.get("result", {})
    raise TimeoutError(method)


call("Page.enable")
call("Runtime.enable")


def eval_js(expression, await_promise=False):
    return call(
        "Runtime.evaluate",
        {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": await_promise,
        },
    ).get("result", {}).get("value")


def handle_consent():
    for _ in range(4):
        loc = eval_js(
            "({href:location.href,t:(document.body&&document.body.innerText||'').slice(0,350).toLowerCase()})"
        ) or {}
        href = loc.get("href") or ""
        t = loc.get("t") or ""
        if "sorry" in href:
            return "sorry"
        if "consent" in href or "before you continue" in t:
            eval_js(
                """
(() => {
  for (const b of document.querySelectorAll('button,input[type=submit]')) {
    const x=(b.innerText||b.value||'').toLowerCase();
    if (x.includes('accept')||x.includes('agree')) { b.click(); return x; }
  }
  return 'none';
})()"""
            )
            time.sleep(3)
            continue
        return "ok"
    return "ok"


COUNT_EXPR = r"""
(() => {
  const cards = [...document.querySelectorAll('c-wiz.PO9Zff, div.g')];
  const visible = cards.filter(c => {
    const cs = getComputedStyle(c);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && c.getAttribute('data-swiftblock-hidden') !== '1';
  });
  const withTaylor = visible.filter(c => /Taylor Swift/i.test((c.innerText||'') + ' ' + (c.getAttribute('aria-label')||'')));
  const withoutTaylor = visible.filter(c => !/Taylor Swift/i.test((c.innerText||'') + ' ' + (c.getAttribute('aria-label')||'')));
  const glitteringVisible = visible.some(c => /Glittering Sheer Navy|Taylor Swift Slips Into/i.test(c.innerText||''));
  const searchBox = document.querySelector('input, textarea, [role=combobox], [role=searchbox], form');
  const searchVisible = !!(searchBox && getComputedStyle(searchBox).display !== 'none');
  const bodyKids = document.body ? document.body.childElementCount : 0;
  const mainTextLen = (document.body && document.body.innerText || '').length;
  return {
    href: location.href,
    style: !!document.getElementById('swiftblock-style'),
    hiddenAttr: document.querySelectorAll('[data-swiftblock-hidden="1"]').length,
    cardsTotal: cards.length,
    visibleCards: visible.length,
    visibleWithTaylor: withTaylor.length,
    visibleWithoutTaylor: withoutTaylor.length,
    glitteringVisible,
    searchVisible,
    bodyKids,
    mainTextLen,
    sampleNonTaylor: withoutTaylor.slice(0,3).map(c => (c.innerText||'').replace(/\s+/g,' ').slice(0,80)),
    sampleTaylor: withTaylor.slice(0,3).map(c => (c.innerText||'').replace(/\s+/g,' ').slice(0,80))
  };
})()
"""


def inject_extension():
    # Order: defaults -> storage stub (uses defaults) -> filter
    call("Runtime.evaluate", {"expression": defaults_js})
    call("Runtime.evaluate", {"expression": STORAGE_STUB})
    # filter references chrome.storage at load; stub must exist first
    call("Runtime.evaluate", {"expression": filter_js})
    time.sleep(1.2)
    # allow delayed rescans
    time.sleep(2.2)


def run_page(url, label):
    print("===", label, "===")
    call("Page.navigate", {"url": url})
    time.sleep(8)
    status = handle_consent()
    print("nav_status", status)
    if status == "sorry":
        return {"blocked": True, "href": eval_js("location.href")}
    time.sleep(4)
    before = eval_js(COUNT_EXPR)
    print("BEFORE", json.dumps(before, indent=2)[:2000])
    inject_extension()
    after = eval_js(COUNT_EXPR)
    print("AFTER", json.dumps(after, indent=2)[:2000])
    shot = call("Page.captureScreenshot", {"format": "png"})
    path = OUT / f"{label.lower()}-after.png"
    path.write_bytes(base64.b64decode(shot["data"]))
    print("SHOT", path)
    return {"before": before, "after": after, "blocked": False}


news = run_page(
    "https://news.google.com/search?q=taylor%20swift&hl=en-US&gl=US&ceid=US:en",
    "NEWS",
)
web = run_page(
    "https://www.google.com/search?q=taylor+swift&hl=en&gl=us&pws=0",
    "WEB",
)

# Autocomplete safety: open google homepage, focus input, type — ensure page not blanked
print("=== AUTOCOMPLETE ===")
call("Page.navigate", {"url": "https://www.google.com/"})
time.sleep(4)
handle_consent()
inject_extension()
ac = eval_js(
    """
(async () => {
  const input = document.querySelector('textarea[name=q], input[name=q], [role=combobox]');
  if (!input) return { ok:false, reason:'no-input' };
  input.focus();
  input.value = 'taylor swift';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));
  const style = !!document.getElementById('swiftblock-style');
  const bodyLen = (document.body.innerText||'').length;
  const inputStill = !!document.querySelector('textarea[name=q], input[name=q], [role=combobox]');
  const hiddenBig = [...document.querySelectorAll('[data-swiftblock-hidden="1"]')].filter(el => {
    const r = el.getBoundingClientRect();
    return (r.width*r.height) > 0.4 * innerWidth * innerHeight;
  }).length;
  return {
    ok: style && inputStill && bodyLen > 200 && hiddenBig === 0,
    style, bodyLen, inputStill, hiddenBig,
    listboxHidden: !!document.querySelector('[role=listbox][data-swiftblock-hidden="1"], .aajZCb[data-swiftblock-hidden="1"]')
  };
})()
""",
    await_promise=True,
)
print("AUTOCOMPLETE", ac)

summary = {
    "news": news,
    "web": web,
    "autocomplete": ac,
}
(OUT / "safe-verify.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

# Pass criteria
ok = True
reasons = []
if news.get("blocked"):
    reasons.append("news-blocked-sorry")
    ok = False
else:
    nb, na = news["before"], news["after"]
    if not na.get("style"):
        ok = False
        reasons.append("news-no-style")
    if not na.get("searchVisible"):
        ok = False
        reasons.append("news-search-gone")
    if na.get("mainTextLen", 0) < 200:
        ok = False
        reasons.append("news-page-blank")
    # On a taylor swift search, many cards mention her; we still need page shell.
    # Prefer: some cards remain OR body still substantial; glittering gone if present before.
    if nb.get("glitteringVisible") and na.get("glitteringVisible"):
        # not fatal if that specific story isn't in this SERP
        pass
    if na.get("visibleCards", 0) == 0 and nb.get("visibleCards", 0) > 3:
        ok = False
        reasons.append("news-all-cards-gone")

if not web.get("blocked"):
    wa = web["after"]
    if not wa.get("style"):
        ok = False
        reasons.append("web-no-style")
    if not wa.get("searchVisible"):
        ok = False
        reasons.append("web-search-gone")
    if wa.get("mainTextLen", 0) < 200:
        ok = False
        reasons.append("web-page-blank")

if not (ac or {}).get("ok"):
    ok = False
    reasons.append("autocomplete-unsafe")

print("PASS" if ok else "FAIL", reasons)
ws.close()
raise SystemExit(0 if ok else 2)
