import json, time, urllib.request, pathlib
import websocket

PORT = 9333
OUT = pathlib.Path(r"C:\code_9_17_25\blankspace\demo")
OUT.mkdir(parents=True, exist_ok=True)

def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))

def get_page():
    pages = [t for t in targets() if t.get("type") == "page" and "webSocketDebuggerUrl" in t]
    if not pages:
        raise SystemExit("no page target")
    # prefer non-devtools
    for t in pages:
        if not t.get("url", "").startswith("devtools://"):
            return t
    return pages[0]

meta = get_page()
print("PAGE", meta.get("url"), meta.get("id"))
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
call("Network.enable")

url = "https://news.google.com/search?q=taylor%20swift&hl=en-US&gl=US&ceid=US:en"
print("NAV", url)
call("Page.navigate", {"url": url})
time.sleep(8)

# consent / continue helpers
for _ in range(8):
    info = call("Runtime.evaluate", {
        "expression": "({href: location.href, title: document.title, body: (document.body&&document.body.innerText||'').slice(0,500)})",
        "returnByValue": True
    })
    val = info.get("result", {}).get("value") or {}
    print("LOC", val.get("href"), "|", val.get("title"))
    text = (val.get("body") or "").lower()
    href = val.get("href") or ""
    if "consent" in href or "before you continue" in text or "i agree" in text or "accept all" in text:
        print("CONSENT PAGE - trying accept")
        call("Runtime.evaluate", {"expression": """
(() => {
  const labels = ['I agree', 'Accept all', 'Accept All', 'Agree', 'Accept'];
  const buttons = [...document.querySelectorAll('button, input[type=submit], div[role=button]')];
  for (const b of buttons) {
    const t = (b.innerText || b.value || '').trim();
    if (labels.some(l => t.toLowerCase() === l.toLowerCase() || t.toLowerCase().includes('accept all') || t.toLowerCase().includes('i agree'))) {
      b.click(); return t;
    }
  }
  // form submit fallback
  const form = document.querySelector('form');
  if (form) { form.submit(); return 'form-submit'; }
  return 'no-button';
})()
""", "returnByValue": True})
        time.sleep(4)
        continue
    break

time.sleep(6)

# Wait for articles
for i in range(20):
    n = call("Runtime.evaluate", {"expression": "document.querySelectorAll('article').length", "returnByValue": True})
    count = n.get("result", {}).get("value") or 0
    print(f"articles[{i}]={count}")
    if count > 0:
        break
    time.sleep(1)

time.sleep(3)

probe = r"""
(() => {
  const style = document.getElementById('swiftblock-style');
  const hidden = document.querySelectorAll('[data-swiftblock-hidden="1"]');
  const articles = [...document.querySelectorAll('article')];
  const glittering = [];
  const walk = (root) => {
    const nodes = root.querySelectorAll ? [...root.querySelectorAll('*')] : [];
    for (const el of [root, ...nodes]) {
      if (!(el instanceof Element)) continue;
      const aria = el.getAttribute?.('aria-label') || '';
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ');
      const blob = aria + ' ' + text;
      if (/Glittering Sheer Navy|Academy Museum Gala|Meg Walters/i.test(blob) ||
          (/Taylor Swift Slips Into/i.test(blob))) {
        glittering.push({
          tag: el.tagName,
          id: el.id || '',
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
          aria: aria.slice(0, 160),
          text: text.slice(0, 160),
          hiddenAttr: el.getAttribute('data-swiftblock-hidden'),
          display: getComputedStyle(el).display,
          inArticle: !!el.closest('article'),
          articleHidden: el.closest('article')?.getAttribute('data-swiftblock-hidden') || null,
          articleDisplay: el.closest('article') ? getComputedStyle(el.closest('article')).display : null,
          parentChain: (() => {
            const chain = [];
            let p = el;
            for (let i = 0; p && i < 10; i++) {
              chain.push(p.tagName + (p.id ? '#' + p.id : '') + (typeof p.className === 'string' && p.className ? '.' + p.className.split(/\s+/).slice(0,2).join('.') : ''));
              p = p.parentElement;
            }
            return chain;
          })(),
          shadowHost: !!el.getRootNode && el.getRootNode() instanceof ShadowRoot
        });
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document.documentElement);

  // extension presence
  let runtimeId = null;
  try { runtimeId = chrome?.runtime?.id || null; } catch (e) { runtimeId = 'err:' + e.message; }

  return {
    href: location.href,
    title: document.title,
    stylePresent: !!style,
    hiddenCount: hidden.length,
    articleCount: articles.length,
    runtimeId,
    hasTaylorInBody: /Taylor Swift/i.test(document.body.innerText || ''),
    glitteringCount: glittering.length,
    glittering: glittering.slice(0, 12),
    sampleArticles: articles.slice(0, 8).map(a => ({
      hidden: a.getAttribute('data-swiftblock-hidden'),
      display: getComputedStyle(a).display,
      text: (a.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      aria: (a.getAttribute('aria-label') || a.querySelector('[aria-label]')?.getAttribute('aria-label') || '').slice(0, 120)
    }))
  };
})()
"""
res = call("Runtime.evaluate", {"expression": probe, "returnByValue": True, "awaitPromise": False})
val = res.get("result", {}).get("value")
path = OUT / "news-probe.json"
path.write_text(json.dumps(val, indent=2), encoding="utf-8")
print("WROTE", path)
print(json.dumps(val, indent=2)[:9000])
ws.close()
