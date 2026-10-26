"""The share images in headless Chromium: every case, every locale.

    python3 -B tool/tests/share/e2e.py              # judge every case, compare the references
    python3 -B tool/tests/share/e2e.py --update     # draw the references again (then look at them)
    python3 -B tool/tests/share/e2e.py --locales en,de

Serves the repo read-only on 127.0.0.1 (js/, fonts/ and this folder) and
draws each case of cases.json with js/tools/share-card.js and
js/tools/share-tune.js through fixture.html. Writes nothing into the repo:
the reference PNGs live in SCALITA_SCRATCH/share, else the temp folder,
and a missing one is drawn and kept, to be looked at once.

  layout      every case in all seven locales with their own strings, and
              again with the English copy 40% longer, word by word, in each
              locale's notes, numbers and dates (room for a translation 40%
              longer than the source): nothing outside the frame, no text on
              another text, a key, a voice's line or a landing, nothing
              squeezed, no placeholder left (fixture.mjs judges)
  pixels      each reference case, drawn with the English strings frozen in
              cases.json (a translation landing moves no reference), against
              its PNG: on average under half a level in 255, and under 0.05%
              of pixels off by more than 24 (a changed word is caught; the
              same machine draws the same)
  fonts       Sora 200 loaded by the module itself, before it draws; only
              the module, the fonts and this folder requested
  no filter   a browser without ctx.filter (Safari before 18) draws the
              same image: the blurs are shadows, which every browser has
  budget      each module's size gzipped against the spec's 4 KB, printed;
              share.test.mjs holds the ceilings (the range module is over
              the spec's figure: see README.md)
  webkit      the first cases of each image in WebKit, through Node and a
              playwright-core whose WebKit is installed (SCALITA_PLAYWRIGHT_CORE,
              else found as tool/tests/e2e/run.py finds one): judged the same
              way, and close to Chromium's drawing; skipped without one
"""
import argparse
import base64
import glob
import gzip
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.dont_write_bytecode = True  # everything in this repo is served: leave no __pycache__
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CASES = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
LOCALES = ["en", "es", "fr", "pt", "de", "tr", "id"]
KINDS = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".html": "text/html; charset=utf-8",
         ".woff2": "font/woff2", ".png": "image/png"}


def refs_dir():
    d = Path(os.environ.get("SCALITA_SCRATCH") or Path(tempfile.gettempdir()) / "scalita-tests") / "share"
    d.mkdir(parents=True, exist_ok=True)
    return d


def webkit_core():
    """A playwright-core whose WebKit build is installed, found the way
    tool/tests/e2e/run.py finds one."""
    home = Path.home()
    cands = [os.environ.get("SCALITA_PLAYWRIGHT_CORE")]
    try:
        import playwright
        cands.append(str(Path(playwright.__file__).parent / "driver" / "package"))
    except ImportError:
        pass
    cands += sorted(glob.glob(str(home / "projects" / "*" / "node_modules" / "playwright-core")))
    cands += sorted(glob.glob(str(home / ".npm" / "_npx" / "*" / "node_modules" / "playwright-core")))
    browsers = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or home / ".cache" / "ms-playwright")
    for c in cands:
        try:
            b = json.loads((Path(c) / "browsers.json").read_text())
        except (TypeError, OSError, ValueError):
            continue
        rev = next((x["revision"] for x in b["browsers"] if x["name"] == "webkit"), None)
        if rev and (browsers / ("webkit-" + rev)).is_dir():
            return c
    return None


def frozen(pd):
    """A locale's page data with the strings frozen in cases.json: its own
    notes, numbers and dates, the reviewed words."""
    return dict(pd, strings=CASES["frozen"])


def page_data(tool, loc):
    run = subprocess.run([sys.executable, "-B", str(REPO / "tool" / "build.py"), "--allow-missing",
                          "--page-data", tool, "--locale", loc],
                         capture_output=True, text=True, cwd=str(REPO), check=True)
    return json.loads(run.stdout)


class Handler(http.server.BaseHTTPRequestHandler):
    log = []
    refs = None

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        Handler.log.append((time.monotonic(), path))
        if ".." in path:
            return self.send_error(404)
        if path.startswith("/ref/"):
            f = Handler.refs / path[5:]
        elif path.startswith(("/js/", "/fonts/", "/tool/tests/share/")):
            f = REPO / path.lstrip("/")
        else:
            f = None
        if f and f.is_file():
            body = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", KINDS.get(f.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(body)
        if path == "/favicon.ico":
            self.send_response(204)
            return self.end_headers()
        self.send_error(404)


class Run:
    def __init__(self, origin, update):
        self.origin, self.update = origin, update
        self.checks, self.notes = [], []

    def check(self, name, ok, got=None):
        self.checks.append((name, bool(ok), got))

    def open(self, browser, query=""):
        page = browser.new_page(viewport={"width": 400, "height": 400})
        logs = []
        page.on("console", lambda m: logs.append("%s: %s" % (m.type, m.text)) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: logs.append("pageerror: %s" % e))
        page.goto(self.origin + "/tool/tests/share/fixture.html" + query)
        page.wait_for_function("window.share")
        page.evaluate("window.share.ready")
        return page, logs

    def draw(self, page, kind, case, data, stretch=False, png=False):
        return page.evaluate("([k, c, d, cs, o]) => window.share.run(k, c, d, cs, o)",
                             [kind, case, data, CASES, {"stretch": stretch, "png": png}])

    def reference(self, page, name, png):
        f = refs_dir() / (name + ".png")
        if self.update or not f.exists():
            f.write_bytes(base64.b64decode(png.split(",", 1)[1]))
            self.notes.append("drew %s: look at it once" % f)
            return
        d = page.evaluate("([a, b]) => window.share.compare(a, b)", [png, "/ref/" + f.name])
        self.check("pixels: %s" % name, "mean" in d and d["mean"] < 0.5 and d["over"] < 0.0005, d)


def webkit(run, data, kinds, pngs):
    core, node = webkit_core(), shutil.which("node")
    if not core or not node or ("vocal-range-test", "en") not in data:
        return print("SKIP webkit: no node, no English, or no playwright-core with an installed WebKit")
    jobs = [{"kind": kind, "case": case, "data": frozen(data[(tool, "en")]), "ref": pngs.get(("en", case["id"]))}
            for kind, tool, cases in kinds for case in cases[:3]]
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"cases": CASES, "jobs": jobs}, f)
    try:
        res = subprocess.run([node, str(HERE / "webkit.mjs"), core, run.origin, f.name], capture_output=True, text=True, timeout=600)
    finally:
        os.unlink(f.name)
    try:
        out = json.loads(res.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        return run.check("webkit: it ran", False, (res.stderr or res.stdout)[-600:])
    for r in out["results"]:
        run.check("webkit %s: %s layout" % (out["version"], r["id"]), not r["bad"], r["bad"])
        run.check("webkit: %s drawn with Sora 200" % r["id"], r["thin"] and r["size"] == [1080, 1920], r)
        d = r["diff"]
        if d is not None:
            run.check("webkit: %s close to Chromium's drawing" % r["id"], "mean" in d and d["mean"] < 3 and d["over"] < 0.02, d)
    run.check("webkit: console clean", not out["logs"], out["logs"])
    if not out.get("letterSpacing"):
        run.notes.append("webkit %s has no canvas letterSpacing: the tracked capitals draw untracked there" % out["version"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="draw every reference PNG again")
    ap.add_argument("--locales", default=",".join(LOCALES))
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    locales = [x for x in args.locales.split(",") if x]
    data = {(t, loc): page_data(t, loc) for t in ("vocal-range-test", "sing-in-tune-test") for loc in set(locales) | {"en"}}
    Handler.refs = refs_dir()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    run = Run("http://127.0.0.1:%d" % server.server_address[1], args.update)
    kinds = [("range", "vocal-range-test", CASES["range"]), ("tune", "sing-in-tune-test", CASES["tune"])]
    pngs = {}
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(channel="chromium", headless=True)
            except Exception:
                browser = p.chromium.launch(headless=True)
            page, logs = run.open(browser)
            t0 = time.monotonic()
            for loc in locales:
                refs = CASES["references"].get(loc, [])
                for kind, tool, cases in kinds:
                    for case in cases:
                        label = "%s %s" % (loc, case["id"])
                        r = run.draw(page, kind, case, data[(tool, loc)])
                        run.check("layout: " + label, not r["bad"], r["bad"])
                        run.check("canvas: " + label, r["size"] == [1080, 1920] and r["same"], r["size"])
                        run.check("fonts: %s drawn with Sora 200" % label, r["thin"])
                        r = run.draw(page, kind, case, dict(data[(tool, loc)], strings=data[(tool, "en")]["strings"]), stretch=True)
                        run.check("layout, the English 40%% longer: %s" % label, not r["bad"], r["bad"])
                        if case["id"] in refs:
                            r = run.draw(page, kind, case, frozen(data[(tool, loc)]), png=True)
                            run.check("layout, frozen words: " + label, not r["bad"], r["bad"])
                            pngs[(loc, case["id"])] = r["png"]
                            run.reference(page, "%s-%s" % (loc, case["id"]), r["png"])
            asked = sorted({path for t, path in Handler.log if t >= t0})
            run.check("fonts: the module loads Sora 200 itself", "/fonts/sora-200.woff2" in asked, asked)
            run.check("requests: the modules, the fonts, nothing else",
                      all(a.startswith(("/js/tools/share-", "/fonts/sora-", "/ref/", "/tool/tests/share/")) for a in asked), asked)
            run.check("console clean", not logs, logs)
            page.close()

            # Without ctx.filter, the shadow-cast blur
            page, logs = run.open(browser, "?nofilter")
            run.check("no filter: the page has none", page.evaluate("window.share.nofilter && !('filter' in CanvasRenderingContext2D.prototype)"))
            for kind, tool, cases in kinds:
                case = cases[0]
                if ("en", case["id"]) not in pngs:
                    continue
                r = run.draw(page, kind, case, frozen(data[(tool, "en")]), png=True)
                d = page.evaluate("([a, b]) => window.share.compare(a, b)", [r["png"], pngs[("en", case["id"])]])
                run.check("no filter: %s looks the same" % case["id"], "mean" in d and d["mean"] < 1 and d["over"] < 0.005, d)
                run.check("no filter: %s layout" % case["id"], not r["bad"], r["bad"])
            run.check("no filter: console clean", not logs, logs)
            browser.close()
        webkit(run, data, kinds, pngs)
    finally:
        server.shutdown()

    for f in ("js/tools/share-card.js", "js/tools/share-tune.js"):
        n = len(gzip.compress((REPO / f).read_bytes(), 9))
        if n > 4096:
            run.notes.append("budget: %s is %d bytes gzipped, over the spec's 4 KB" % (f, n))
        else:
            run.check("budget: %s under 4 KB gzipped" % f, True, n)
    failed = 0
    for name, ok, got in run.checks:
        print("%s %s%s" % ("ok  " if ok else "FAIL", name, "" if ok or got is None else ": " + json.dumps(got, ensure_ascii=False)[:900]))
        failed += not ok
    for n in run.notes:
        print("note " + n)
    print("PASS" if not failed else "FAIL (%d)" % failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
