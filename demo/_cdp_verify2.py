import json, time, urllib.request, base64, pathlib
import websocket

PORT = 9333
OUT = pathlib.Path(r"C:\code_9_17_25\blankspace\demo")
OUT.mkdir(parents=True, exist_ok=True)
FIX = (OUT.parent / "demo" / "google-news-fixture.html").as_uri()


def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))


def get_page():
    for t in targets():
        if t.get("type") == "page" and "webSocketDebuggerUrl" in t:
            u = t.get("url") or ""
            if not u.startswith("devtools:"):
                return t
    raise SystemExit("no page")


def find_ext_id():
    for t in targets():
        u = t.get("url") or ""
        if u.startswith("chrome-extension://"):
            eid = u.split("/")[2]
            if eid != "nkeimhogjdpnpccoofpliimaahmaaome":
                return eid
    return None


meta = get_page()
print("PAGE", meta.get("url"))
print("EXT_TARGETS:")
for t in targets():
    u = t.get("url") or ""
    if "extension" in u or t.get("type") == "service_worker":
        print(" ", t.get("type"), u[:140])

ws = websocket.create_connection(meta["webSocketDebuggerUrl"], timeout=120)
mid = 0


def call(method, params=None, timeout=120):
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

ext_id = find_ext_id()
print("EXT_ID", ext_id)

# Confirm extension assets
if ext_id:
    call("Page.navigate", {"url": f"chrome-extension://{ext_id}/manifest.json"})
    time.sleep(1)
    man = call(
        "Runtime.evaluate",
        {
            "returnByValue": True,
            "expression": "document.body ? document.body.innerText : document.documentElement.textContent",
        },
    )
    print("MANIFEST", (man.get("result", {}) or {}).get("value", "")[:500])

# example.com — content script smoke
call("Page.navigate", {"url": "https://example.com/"})
time.sleep(3)
ex = call(
    "Runtime.evaluate",
    {
        "returnByValue": True,
        "expression": "({href:location.href, style:!!document.getElementById('swiftblock-style'), logs: window.__swiftblock_seen || null})",
    },
)
print("EXAMPLE", ex.get("result", {}).get("value"))

# Local news fixture via simple http server isn't needed if we inject — but fixture is file://
# file:// won't get content scripts. Use CDP to load fixture over data? Skip.
# Instead navigate news.google.com

call(
    "Page.navigate",
    {
        "url": "https://news.google.com/search?q=taylor%20swift&hl=en-US&gl=US&ceid=US:en"
    },
)
time.sleep(10)
# consent / sorry handling
for _ in range(4):
    loc = call(
        "Runtime.evaluate",
        {
            "returnByValue": True,
            "expression": "({href:location.href,t:(document.body&&document.body.innerText||'').slice(0,400).toLowerCase()})",
        },
    )
    val = loc.get("result", {}).get("value") or {}
    href = val.get("href") or ""
    t = val.get("t") or ""
    print("LOC", href[:120])
    if "sorry" in href or "captcha" in t:
        print("BLOCKED by sorry/captcha")
        break
    if "consent" in href or "before you continue" in t:
        call(
            "Runtime.evaluate",
            {
                "expression": """
(() => {
  for (const b of document.querySelectorAll('button,input[type=submit]')) {
    const x=(b.innerText||b.value||'').toLowerCase();
    if (x.includes('accept')||x.includes('agree')) { b.click(); return x; }
  }
  return 'none';
})()"""
            },
        )
        time.sleep(4)
        continue
    break

time.sleep(5)
news = call(
    "Runtime.evaluate",
    {
        "returnByValue": True,
        "expression": r"""
(() => {
  const style = !!document.getElementById('swiftblock-style');
  const hidden = document.querySelectorAll('[data-swiftblock-hidden="1"]').length;
  const cards = [...document.querySelectorAll('c-wiz.PO9Zff')];
  const glittering = [];
  for (const c of cards) {
    const text = (c.innerText||'').replace(/\s+/g,' ');
    if (/Glittering Sheer Navy|Taylor Swift Slips Into/i.test(text)) {
      glittering.push({
        hidden: c.getAttribute('data-swiftblock-hidden'),
        display: getComputedStyle(c).display,
        text: text.slice(0,140)
      });
    }
  }
  const taylorCards = cards.filter(c => /Taylor Swift/i.test(c.innerText||''));
  return {
    href: location.href,
    style,
    hidden,
    cardCount: cards.length,
    taylorTotal: taylorCards.length,
    taylorHidden: taylorCards.filter(c => c.getAttribute('data-swiftblock-hidden')==='1' || getComputedStyle(c).display==='none').length,
    glittering,
    bodyHasGlittering: /Glittering Sheer Navy/i.test(document.body.innerText||'')
  };
})()""",
    },
)
news_val = news.get("result", {}).get("value")
print("NEWS", json.dumps(news_val, indent=2)[:4000])

shot = call("Page.captureScreenshot", {"format": "png"})
(OUT / "news-after.png").write_bytes(base64.b64decode(shot["data"]))
print("SHOT", OUT / "news-after.png")

# Google web search
call(
    "Page.navigate",
    {"url": "https://www.google.com/search?q=taylor+swift&hl=en&gl=us&pws=0"},
)
time.sleep(8)
for _ in range(3):
    loc = call(
        "Runtime.evaluate",
        {
            "returnByValue": True,
            "expression": "({href:location.href,t:(document.body&&document.body.innerText||'').slice(0,300).toLowerCase()})",
        },
    )
    val = loc.get("result", {}).get("value") or {}
    if "consent" in (val.get("href") or "") or "before you continue" in (val.get("t") or ""):
        call(
            "Runtime.evaluate",
            {
                "expression": """
(() => {
  for (const b of document.querySelectorAll('button,input[type=submit]')) {
    const x=(b.innerText||b.value||'').toLowerCase();
    if (x.includes('accept')||x.includes('agree')) { b.click(); return x; }
  }
  return 'none';
})()"""
            },
        )
        time.sleep(4)
    else:
        break

time.sleep(3)
web = call(
    "Runtime.evaluate",
    {
        "returnByValue": True,
        "expression": r"""
(() => {
  const style = !!document.getElementById('swiftblock-style');
  const hidden = document.querySelectorAll('[data-swiftblock-hidden="1"]').length;
  const gs = [...document.querySelectorAll('div.g')].map(g => ({
    hidden: g.getAttribute('data-swiftblock-hidden'),
    display: getComputedStyle(g).display,
    text: (g.innerText||'').replace(/\s+/g,' ').slice(0,100)
  }));
  return { href: location.href, style, hidden, gCount: gs.length, sample: gs.slice(0,6) };
})()""",
    },
)
web_val = web.get("result", {}).get("value")
print("WEB", json.dumps(web_val, indent=2)[:4000])

# Popup smoke: open popup page and toggle
if ext_id:
    call("Page.navigate", {"url": f"chrome-extension://{ext_id}/popup/popup.html"})
    time.sleep(1)
    pop = call(
        "Runtime.evaluate",
        {
            "returnByValue": True,
            "awaitPromise": True,
            "expression": """
(async () => {
  const enabled = document.getElementById('enabled');
  const list = document.getElementById('keyword-list');
  await new Promise(r => setTimeout(r, 400));
  const before = enabled ? enabled.checked : null;
  const count = list ? list.children.length : 0;
  if (enabled) {
    enabled.checked = !enabled.checked;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
  }
  const after = enabled ? enabled.checked : null;
  // restore
  if (enabled && after !== before) {
    enabled.checked = before;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return {
    hasDefaults: !!(globalThis.SWIFTBLOCK_DEFAULTS && globalThis.SWIFTBLOCK_DEFAULTS.DEFAULT_KEYWORDS),
    keywordCount: count,
    toggleBefore: before,
    toggleAfter: after,
    title: document.title
  };
})()""",
        },
    )
    print("POPUP", pop.get("result", {}).get("value"))

(OUT / "verify-results.json").write_text(
    json.dumps({"news": news_val, "web": web_val, "ext_id": ext_id}, indent=2),
    encoding="utf-8",
)
ws.close()
print("DONE")
