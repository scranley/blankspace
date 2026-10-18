import json, time, urllib.request, base64, pathlib
import websocket

PORT = 9333
OUT = pathlib.Path(r"C:\code_9_17_25\blankspace\demo")
OUT.mkdir(parents=True, exist_ok=True)

def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))

def get_page():
    for t in targets():
        if t.get("type") == "page" and "webSocketDebuggerUrl" in t and not (t.get("url") or "").startswith("devtools:"):
            return t
    raise SystemExit("no page")

meta = get_page()
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
call("Console.enable")

logs = []

# Drain console via events while waiting — use Runtime.evaluate for probe

def navigate_and_probe(url, label, wait=10):
    print("===", label, "===")
    call("Page.navigate", {"url": url})
    time.sleep(wait)
    # consent click if needed
    for _ in range(3):
        info = call("Runtime.evaluate", {"returnByValue": True, "expression": "({href:location.href,t:(document.body&&document.body.innerText||'').slice(0,300).toLowerCase()})"})
        val = info.get("result", {}).get("value") or {}
        if "consent" in (val.get("href") or "") or "before you continue" in (val.get("t") or ""):
            call("Runtime.evaluate", {"expression": """
(() => {
  const buttons=[...document.querySelectorAll('button,input[type=submit]')];
  for (const b of buttons) {
    const t=(b.innerText||b.value||'').toLowerCase();
    if (t.includes('accept') || t.includes('agree') || t.includes('i agree')) { b.click(); return t; }
  }
  return 'none';
})()
"""})
            time.sleep(4)
        else:
            break
    time.sleep(4)
    probe = call("Runtime.evaluate", {"returnByValue": True, "expression": r"""
(() => {
  const style = document.getElementById('swiftblock-style');
  const hidden = [...document.querySelectorAll('[data-swiftblock-hidden="1"]')];
  const glittering = [];
  for (const el of document.querySelectorAll('c-wiz.PO9Zff, article, div.g, a.JtKRv, h3')) {
    const blob = ((el.getAttribute('aria-label')||'') + ' ' + (el.innerText||'')).replace(/\s+/g,' ');
    if (/Glittering Sheer Navy|Taylor Swift Slips Into|InStyle.*Meg Walters/i.test(blob)) {
      const card = el.closest('c-wiz.PO9Zff, article, div.g') || el;
      glittering.push({
        tag: el.tagName,
        cardTag: card.tagName,
        cardCls: (typeof card.className==='string'?card.className:'').slice(0,60),
        hidden: card.getAttribute('data-swiftblock-hidden'),
        display: getComputedStyle(card).display,
        text: blob.slice(0,120)
      });
    }
  }
  // count taylor-related visible cards on news
  const newsCards = [...document.querySelectorAll('c-wiz.PO9Zff')].map(c => {
    const t=(c.innerText||'').replace(/\s+/g,' ');
    return {
      hasTaylor: /Taylor Swift/i.test(t),
      hidden: c.getAttribute('data-swiftblock-hidden'),
      display: getComputedStyle(c).display,
      text: t.slice(0,80)
    };
  });
  const organic = [...document.querySelectorAll('div.g')].slice(0,8).map(g => ({
    hidden: g.getAttribute('data-swiftblock-hidden'),
    display: getComputedStyle(g).display,
    text: (g.innerText||'').replace(/\s+/g,' ').slice(0,100)
  }));
  return {
    href: location.href,
    title: document.title,
    stylePresent: !!style,
    hiddenCount: hidden.length,
    glittering,
    newsTaylorVisible: newsCards.filter(c => c.hasTaylor && c.display !== 'none' && c.hidden !== '1').length,
    newsTaylorHidden: newsCards.filter(c => c.hasTaylor && (c.display === 'none' || c.hidden === '1')).length,
    newsCardTotal: newsCards.length,
    organic,
    bodyStillHasGlittering: /Glittering Sheer Navy/i.test(document.body.innerText||'')
  };
})()
"""})
    val = probe.get("result", {}).get("value")
    print(json.dumps(val, indent=2)[:5000])
    return val

news = navigate_and_probe(
    "https://news.google.com/search?q=taylor%20swift&hl=en-US&gl=US&ceid=US:en",
    "NEWS",
    wait=8,
)

# Screenshot news
shot = call("Page.captureScreenshot", {"format": "png"})
png = base64.b64decode(shot["data"])
shot_path = OUT / "news-after.png"
shot_path.write_bytes(png)
print("SCREENSHOT", shot_path, "bytes", len(png))

web = navigate_and_probe(
    "https://www.google.com/search?q=taylor+swift&hl=en&gl=us&pws=0",
    "WEB",
    wait=8,
)

(OUT / "verify-results.json").write_text(json.dumps({"news": news, "web": web}, indent=2), encoding="utf-8")
ws.close()
print("DONE")
