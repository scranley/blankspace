/* Quick smoke: curl 2 pages, run filter in jsdom, print hide counts. */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { JSDOM } = require(path.join(__dirname, "..", "node_modules", "jsdom"));

const ROOT = path.join(__dirname, "..");

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html"
        },
        timeout: 15000
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(new URL(res.headers.location, url).href).then(resolve, reject);
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, html: data }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function runFilter(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;

  // Stub layout: give articles/cards a plausible box; shells stay large.
  const proto = window.HTMLElement.prototype;
  proto.getBoundingClientRect = function getBoundingClientRect() {
    const tag = this.tagName;
    const cls = typeof this.className === "string" ? this.className : "";
    if (tag === "HTML" || tag === "BODY" || tag === "MAIN") {
      return { x: 0, y: 0, width: 1200, height: 2000, top: 0, left: 0, bottom: 2000, right: 1200 };
    }
    if (/zQTmif|mtd78e|XCcFNb/.test(cls)) {
      return { x: 0, y: 0, width: 800, height: 1200, top: 0, left: 0, bottom: 1200, right: 800 };
    }
    if (/XBspb|PO9Zff/.test(cls) || tag === "ARTICLE") {
      return { x: 40, y: 40, width: 303, height: 120, top: 40, left: 40, bottom: 160, right: 343 };
    }
    return { x: 40, y: 40, width: 400, height: 160, top: 40, left: 40, bottom: 200, right: 440 };
  };
  Object.defineProperty(window, "innerWidth", { value: 1200 });
  Object.defineProperty(window, "innerHeight", { value: 800 });

  const defaults = fs.readFileSync(path.join(ROOT, "shared", "defaults.js"), "utf8");
  const filter = fs.readFileSync(path.join(ROOT, "content", "filter.js"), "utf8");

  window.chrome = {
    storage: {
      sync: {
        get(defaultsObj) {
          const out = {};
          for (const k of Object.keys(defaultsObj || {})) out[k] = defaultsObj[k];
          return Promise.resolve(out);
        },
        set() {
          return Promise.resolve();
        }
      },
      onChanged: { addListener() {} }
    },
    runtime: { id: "jsdom-smoke" }
  };

  window.eval(defaults);
  window.eval(filter);

  return new Promise((resolve) => {
    setTimeout(() => {
      const hidden = document.querySelectorAll("[data-swiftblock-hidden='1']").length;
      const style = !!document.getElementById("swiftblock-style");
      const bodyLen = (document.body && document.body.innerText || "").length;
      const mainHidden = !!(
        document.documentElement.getAttribute("data-swiftblock-hidden") ||
        document.body.getAttribute("data-swiftblock-hidden") ||
        (document.querySelector("main") &&
          document.querySelector("main").getAttribute("data-swiftblock-hidden"))
      );
      resolve({ hidden, style, bodyLen, mainHidden, url });
    }, 800);
  });
}

async function main() {
  const pages = [
    "https://www.cnn.com/",
    "https://people.com/"
  ];
  const results = [];
  for (const url of pages) {
    try {
      const { status, html } = await fetchText(url);
      const r = await runFilter(html, url);
      results.push({ ...r, status, ok: r.style && !r.mainHidden && r.bodyLen > 100 });
      console.log(
        `${url} status=${status} hidden=${r.hidden} style=${r.style} bodyLen=${r.bodyLen} mainHidden=${r.mainHidden}`
      );
    } catch (e) {
      console.log(`${url} ERROR ${e.message}`);
      results.push({ url, error: e.message, ok: false });
    }
  }
  fs.writeFileSync(path.join(__dirname, "jsdom-smoke-results.json"), JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
