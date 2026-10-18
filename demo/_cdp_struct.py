import json, time, urllib.request, pathlib
import websocket

PORT = 9333

def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))

ts = targets()
print("=== TARGETS ===")
for t in ts:
    print(f"{t.get('type'):20} {(t.get('url') or '')[:120]}")

# Find page on news.google.com
pages = [t for t in ts if t.get("type") == "page"]
news = None
for t in pages:
    if "news.google" in (t.get("url") or ""):
        news = t
        break
if not news and pages:
    news = pages[0]
print("USING", news.get("url") if news else None)

ws = websocket.create_connection(news["webSocketDebuggerUrl"], timeout=60)
mid = 0
def call(method, params=None, timeout=60):
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

call("Page.enable"); call("Runtime.enable")

# Inspect card structure for InStyle / glittering
struct = call("Runtime.evaluate", {"returnByValue": True, "expression": r"""
(() => {
  // find nodes whose text includes Glittering or InStyle gown
  const hits = [];
  for (const el of document.querySelectorAll('a, h3, c-wiz, div')) {
    const t = ((el.getAttribute('aria-label')||'') + ' ' + (el.innerText||'')).replace(/\s+/g,' ');
    if (/Glittering Sheer Navy|InStyle.*Taylor|Taylor Swift Slips Into/i.test(t) && t.length < 400) {
      hits.push({
        tag: el.tagName,
        cls: (typeof el.className==='string'?el.className:'').slice(0,100),
        len: t.length,
        text: t.slice(0,200),
        childElementCount: el.childElementCount,
        closestCwiz: el.closest('c-wiz')?.className || null,
        closestCard: el.closest('c-wiz.PO9Zff, c-wiz.ME1Kbf, div.UwIKyc, div.IBr9hb')?.className || null,
        outer: el.outerHTML.slice(0,300)
      });
      if (hits.length >= 8) break;
    }
  }
  // count potential card roots
  const counts = {
    article: document.querySelectorAll('article').length,
    'c-wiz.PO9Zff': document.querySelectorAll('c-wiz.PO9Zff').length,
    'c-wiz.ME1Kbf': document.querySelectorAll('c-wiz.ME1Kbf').length,
    'a.lgHhnc': document.querySelectorAll('a.lgHhnc').length,
    'h3.hgyOfc': document.querySelectorAll('h3.hgyOfc').length,
    'div.UwIKyc': document.querySelectorAll('div.UwIKyc').length,
    'div.IBr9hb': document.querySelectorAll('div.IBr9hb').length,
    'div.xrnccd': document.querySelectorAll('div.xrnccd').length,
    'div.NiLAwe': document.querySelectorAll('div.NiLAwe').length,
  };
  return {hits, counts, scripts: [...document.scripts].map(s=>s.src).filter(Boolean).slice(0,20)};
})()
"""})
print(json.dumps(struct.get("result",{}).get("value"), indent=2)[:8000])

# Check if extension content scripts registered via Target.getTargets from browser
ws.close()

# Open chrome://extensions in same browser
# Use browser websocket to create target
ver = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version"))
bws = websocket.create_connection(ver["webSocketDebuggerUrl"], timeout=30)
mid=0
def bcall(method, params=None, timeout=30):
    global mid
    mid+=1; i=mid
    bws.send(json.dumps({"id":i,"method":method,"params":params or {}}))
    end=time.time()+timeout
    while time.time()<end:
        data=json.loads(bws.recv())
        if data.get("id")==i:
            if "error" in data: raise RuntimeError(data["error"])
            return data.get("result",{})
    raise TimeoutError(method)

# list targets including extensions
res = bcall("Target.getTargets")
for t in res.get("targetInfos", []):
    u = t.get("url") or ""
    if "extension" in u or t.get("type") in ("service_worker","background_page"):
        print("EXT", t.get("type"), t.get("title"), u[:140])
bws.close()
