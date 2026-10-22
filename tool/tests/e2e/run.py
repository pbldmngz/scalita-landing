"""The built scalita.com, end to end, in Chromium, Firefox and WebKit.

    python3 -B tool/tests/e2e/run.py                    # the site in the repo root, as built
    python3 -B tool/tests/e2e/run.py --site DIR         # a site built with tool/build.py --out DIR
    python3 -B tool/tests/e2e/run.py --only range,tune  # some groups (names below)
    python3 -B tool/tests/e2e/run.py --all              # the unit and per-tool suites first

Serves the site the way GitHub Pages does (a directory answers with its
index.html, anything missing with 404.html, nothing cached) and drives the
real built pages, never a fixture. Builds nothing and writes nothing into the
repo: composed WAVs go to SCALITA_SCRATCH, else the temp folder. The takes are
Pablo's voice and are read in place from scalita_app/test/detector/takes
(SCALITA_TAKES overrides the folder); without them the range group is skipped.

  pages     every page in the sitemaps (and 404.html) at 360 px, English also
            at 1280: no console error or warning, no failed request, nothing
            wider than the screen, every tool mount filled with no stray
            value, the page data contract, every Play link tagged with the
            page's locale and id, no audio before a tap, and the budget:
            scripts before a tap 15 KB gzipped, a tool page's HTML too
  links     every local URL those pages name answers 200, without a redirect
  notfound  404.html is noindex and its links resolve; a missing deep URL
            gets it with its styles and scripts
  langbar   a browser that prefers another language the page exists in gets
            the bar in that language; closed, it stays closed
  decode    every audio/piano-web/*.mp3 in the manifest, and only those,
            decodes gaplessly in Chromium with its attack where ffmpeg has it
  range     the vocal range test locks G2 and G4 from two takes through the
            fake microphone, processing off, no request while listening, the
            result and the tagged Play link; an in-app browser's panel
  tune      sing this note with a steady A4: near 0 cents, five of five,
            the piano and the microphone never at once, no request while live
  player    Pre-Performance Quick for the tenor preset on the quick warm-up page,
            and the five-note scale for soprano on the warm-up piano, play
            the export's roots in order; audio only after Play
  finder    the voice break finder by its buttons, its result kept, and the
            warm-up piano built around it
  locales   every tool in every other built locale, to its result without a
            microphone (the keyboard, the listening check, the finder, the
            piano): nothing stray on it, nothing wider than 360 px
  firefox   geckodriver and Firefox: every English page mounts cleanly, the free
            tuner reads Firefox's fake 1 kHz tone, the warm-up piano plays,
            every MP3 decodes
  webkit    WebKit through a Node playwright-core whose WebKit is installed:
            every MP3 decodes, every English page mounts cleanly, the warm-up
            piano plays the tenor roots of Pre-Performance Quick
"""
import argparse
import glob
import gzip
import http.server
import importlib.util
import json
import math
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

sys.dont_write_bytecode = True  # everything in this repo is served: leave no __pycache__
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BUDGET = 15 * 1024  # gzipped: scripts before a tap on any page, and a tool page's HTML
GROUPS = ("pages", "links", "notfound", "langbar", "decode", "range", "tune", "player", "finder", "locales", "firefox",
          "webkit")
ANDROID = ("Mozilla/5.0 (Linux; Android 14; SM-A725F) AppleWebKit/537.36 (KHTML, like Gecko) "
           "Chrome/151.0.0.0 Mobile Safari/537.36")
INSTAGRAM = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
             "Mobile/15E148 Instagram 390.0.0.27.79 (iPhone15,2; iOS 18_5; en_US)")
STRAY = re.compile(r"\bundefined\b|\bNaN\b|\[object |\{\w+\}")
PAGE_DATA = re.compile(r'<script type="application/json" id="page-data">(.*?)</script>', re.S)
IMPORT_MAP = re.compile(r'<script type="importmap">(.*?)</script>', re.S)
PLAY = "https://play.google.com/store/apps/details?id=com.scalita.app"


def now():
    return time.time() * 1000  # epoch ms, the clock the pages report with timeOrigin + now()


def scratch():
    d = Path(os.environ.get("SCALITA_SCRATCH") or Path(tempfile.gettempdir()) / "scalita-tests") / "e2e"
    d.mkdir(parents=True, exist_ok=True)
    return d


def fill(s, **v):
    return re.sub(r"\{(\w+)\}", lambda m: str(v[m.group(1)]) if m.group(1) in v else m.group(0), s)


def gz(b):
    return len(gzip.compress(b, 9))


# ---------------------------------------------------------------------------
# reporting


class Report:
    def __init__(self):
        self.group, self.passed, self.failed, self.skipped = "", 0, 0, []

    def check(self, name, ok, got=None):
        ok = bool(ok)
        self.passed += ok
        self.failed += not ok
        extra = "" if ok or got is None else ": " + (got if isinstance(got, str) else json.dumps(got, ensure_ascii=False))[:900]
        print("%s %s: %s%s" % ("ok  " if ok else "FAIL", self.group, name, extra), flush=True)
        return ok

    def skip(self, why):
        self.skipped.append("%s: %s" % (self.group, why))
        print("SKIP %s: %s" % (self.group, why), flush=True)

    def info(self, text):
        print("     %s: %s" % (self.group, text), flush=True)


R = Report()


# ---------------------------------------------------------------------------
# the site and its server


class Server:
    """The site as GitHub Pages serves it, with every request logged as
    (epoch ms, path, status, path with its query)."""

    def __init__(self, root):
        log = self.log = []
        notfound = root / "404.html"

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **k):
                super().__init__(*a, directory=str(root), **k)

            def log_message(self, *args):
                pass

            def log_request(self, code="-", size="-"):
                raw = self.path.split("#", 1)[0]
                log.append((now(), raw.split("?", 1)[0], int(getattr(code, "value", code)), raw))

            def end_headers(self):
                self.send_header("Cache-Control", "no-store")
                super().end_headers()

            def send_error(self, code, message=None, explain=None):
                if code != 404 or not notfound.is_file():
                    return super().send_error(code, message, explain)
                body = notfound.read_bytes()
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)

        class Quiet(http.server.ThreadingHTTPServer):
            def handle_error(self, request, address):  # a page closed mid-download is no error
                if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
                    super().handle_error(request, address)

        self.httpd = Quiet(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.origin = "http://127.0.0.1:%d" % self.httpd.server_address[1]

    def since(self, t, prefix=""):
        return [p for at, p, _, _ in list(self.log) if at >= t and p.startswith(prefix)]

    def between(self, a, b):
        return [p for at, p, _, _ in list(self.log) if a <= at <= b]

    def errors_since(self, t):
        return ["%d %s" % (c, p) for at, p, c, _ in list(self.log) if at >= t and c >= 400]

    def raw_since(self, t, prefix):
        return [r for at, p, _, r in list(self.log) if at >= t and p.startswith(prefix)]

    def close(self):
        self.httpd.shutdown()


class Site:
    def __init__(self, root):
        self.root = Path(root)
        self.registry = json.loads((REPO / "tool" / "pages.json").read_text(encoding="utf-8"))
        self.by_id = {e["id"]: e for e in self.registry}
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        paths = []
        for child in ET.parse(self.root / "sitemap.xml").getroot().iter(ns + "loc"):
            for loc in ET.parse(self.root / urlparse(child.text).path.lstrip("/")).getroot().iter(ns + "loc"):
                paths.append(urlparse(loc.text).path)
        self.pages = [(p,) + self.ident(p) for p in paths]  # (path, locale, page id)

    def file(self, path):
        f = self.root / path.lstrip("/")
        return f / "index.html" if path.endswith("/") else f

    def html(self, path):
        return self.file(path).read_text(encoding="utf-8")

    def ident(self, path):
        head = self.html(path)[:400]
        m = re.search(r"tool/content/pages/(\w+)/([\w-]+)\.json", head)
        if m:
            return m.group(1), m.group(2)
        m = re.search(r"tool/content/(\w+)\.json", head)
        name = path.rsplit("/", 1)[1] or "index.html"
        return (m.group(1) if m else "en"), name[:-5]

    def url(self, page_id, code="en"):
        return next((p for p, c, i in self.pages if c == code and i == page_id), None)

    def page_data(self, path):
        m = PAGE_DATA.search(self.html(path))
        return json.loads(m.group(1)) if m else None

    def locales(self):
        return sorted({c for _, c, _ in self.pages}, key=lambda c: "0" if c == "en" else c)


def data(name):
    return json.loads((REPO / "tool" / "data" / "app" / name).read_text(encoding="utf-8"))


def manifest(site):
    return json.loads((site.root / "audio" / "piano-web" / "manifest.json").read_text(encoding="utf-8"))


def label(pd, midi):
    local, intl = pd["notes"][str(midi)]
    return local if local == intl else "%s (%s)" % (local, intl)


# ---------------------------------------------------------------------------
# Chromium


def chromium(p, wav=None):
    args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--mute-audio"]
    if wav:
        args.append("--use-file-for-fake-audio-capture=%s%%noloop" % wav)
    try:
        return p.chromium.launch(channel="chromium", headless=True, args=args)
    except Exception:
        return p.chromium.launch(headless=True, args=args)


class Tab:
    """A fresh context and page that record console errors and warnings,
    page errors and failed requests."""

    def __init__(self, browser, width=360, ua=None, locale=None, init=()):
        opts = {"viewport": {"width": width, "height": 800}}
        if ua:
            opts["user_agent"] = ua
        if locale:
            opts["locale"] = locale
        self.ctx = browser.new_context(**opts)
        for script in init:
            self.ctx.add_init_script(script)
        self.page = self.ctx.new_page()
        self.logs, self.bad, self.scripts, self.requests = [], [], [], []
        pg = self.page
        pg.on("console", lambda m: self.logs.append("%s: %s" % (m.type, m.text)) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: self.logs.append("pageerror: %s" % e))
        pg.on("response", self.response)
        pg.on("requestfailed", lambda r: self.bad.append("failed %s (%s)" % (r.url, r.failure)))
        pg.on("request", lambda r: self.requests.append((r.method, r.url, r.post_data)))
        pg.on("websocket", lambda w: self.requests.append(("WEBSOCKET", w.url, None)))

    def response(self, r):
        if r.status >= 400:
            self.bad.append("%d %s" % (r.status, r.url))
        elif r.request.resource_type == "script":
            self.scripts.append(r)

    def clean(self):
        return self.logs + self.bad

    def sent(self, origin):
        """Every request that is not a plain GET to the site: nothing should
        leave the page but downloads of its own files."""
        return [[m, u] for m, u, body in self.requests if m != "GET" or body or not u.startswith(origin + "/")]

    def close(self):
        self.ctx.close()


# Every tool event, stamped on the epoch clock, from the first byte
EVENTS = """(() => {
  const at = () => performance.timeOrigin + performance.now();
  window.__ev = [];
  for (const type of ['rangetest', 'scalita:player', 'scalita:finder'])
    addEventListener(type, (e) => window.__ev.push(Object.assign({ event: type, at: at() }, e.detail)), true);
})();"""

# The player 25 and the finder 10 times faster: their own test hook, set on
# the mount before the module reads it
FAST = """new MutationObserver(() => {
  for (const el of document.querySelectorAll('[data-tool="player"]:not([data-rate])')) el.dataset.rate = '25';
  for (const el of document.querySelectorAll('[data-tool="voice-break-finder"]:not([data-rate])')) el.dataset.rate = '10';
}).observe(document, { childList: true, subtree: true });"""

# What a page shows: overflow, its mounts, every URL it names
PAGE_JS = """() => {
  const de = document.documentElement;
  const wide = [];
  if (de.scrollWidth > de.clientWidth) {
    const name = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > de.clientWidth + 1) wide.push(name(el) + ' ' + Math.round(r.right));
      if (wide.length > 5) break;
    }
    // a word too long for its line overflows its box, not the box itself
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n && wide.length < 8; n = walk.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(n);
      if ([...range.getClientRects()].some((r) => r.right > de.clientWidth + 1))
        wide.push(name(n.parentElement) + ' "' + n.textContent.trim().slice(0, 40) + '"');
    }
  }
  // a mount the script never filled holds only its <noscript>
  const mounts = [...document.querySelectorAll('[data-tool]')].map((el) => ({ tool: el.dataset.tool,
    player: el.dataset.player || null, kids: [...el.children].filter((c) => c.tagName !== 'NOSCRIPT').length, text: el.innerText }));
  const urls = [];
  for (const [sel, attr] of [['a[href]', 'href'], ['link[href]', 'href'], ['script[src]', 'src'], ['img[src]', 'src'],
                             ['source[src]', 'src'], ['meta[property="og:image"]', 'content']])
    for (const el of document.querySelectorAll(sel)) urls.push(el.getAttribute(attr));
  return { scroll: de.scrollWidth, client: de.clientWidth, wide, mounts, urls };
}"""


def contract(site, pd, html, code, pid, mounts):
    """The page data contract (tool/README.md) for one page: its problems."""
    bad = []
    keys = {"locale", "lang", "pageId", "strings", "notes", "voiceTypes", "registers", "playLink",
            "androidOnlyLine", "piano", "links", "assets", "players"}
    if keys - set(pd):
        bad.append("page data lacks %s" % sorted(keys - set(pd)))
    if (pd.get("locale"), pd.get("pageId")) != (code, pid):
        bad.append("page data says %s/%s" % (pd.get("locale"), pd.get("pageId")))
    strings = pd.get("strings") or {}
    for name in ["common", "mic"] + sorted({m["tool"] for m in mounts}):
        if not strings.get(name):
            bad.append("no strings.%s" % name)
    notes = pd.get("notes") or {}
    if sorted(int(k) for k in notes) != list(range(21, 109)) or not all(
            isinstance(v, list) and len(v) == 2 and all(v) for v in notes.values()):
        bad.append("notes are not MIDI 21 to 108 as [local, intl]")
    types = pd.get("voiceTypes") or []
    if len(types) != 6 or not all(t.get("name") and isinstance(t.get("primo"), int) for t in types):
        bad.append("voiceTypes is not the six localized types")
    tag = "referrer=utm_source%%3Dscalita_%s%%26utm_medium%%3Dweb%%26utm_campaign%%3D%s" % (code, pid)
    if not str(pd.get("playLink")).startswith(PLAY) or tag not in str(pd.get("playLink")):
        bad.append("playLink is not tagged for %s/%s: %s" % (code, pid, pd.get("playLink")))
    if not pd.get("androidOnlyLine"):
        bad.append("no androidOnlyLine")
    piano = pd.get("piano") or {}
    notes = (piano.get("manifest") or {}).get("notes") or []
    if piano.get("base") != "/audio/piano-web/" or len(notes) != 20 or not all(
            (site.root / "audio" / "piano-web" / n["file"]).is_file() for n in notes):
        bad.append("the piano manifest is not the 20 web samples")
    assets = pd.get("assets") or {}
    for k, v in assets.items():
        if not (site.root / k.lstrip("/")).is_file() or not v.startswith(k + "?v="):
            bad.append("asset %s -> %s" % (k, v))
    m = IMPORT_MAP.search(html)
    if mounts and (not m or json.loads(m.group(1)).get("imports") != assets):
        bad.append("the import map does not version the same files as page data assets")
    for t in {m["tool"] for m in mounts}:
        if '<script type="module" src="/js/tools/%s.js?v=' % t not in html:
            bad.append("no module script for %s" % t)
    players = pd.get("players") or {}
    for mt in mounts:
        if mt["tool"] == "player" and (players.get(mt["player"]) or {}).get("kind") not in ("routine", "scale", "chooser"):
            bad.append("no players.%s for its mount" % mt["player"])
    for pid2, href in (pd.get("links") or {}).items():
        if not href.startswith("/") or not site.file(href).is_file():
            bad.append("links.%s %s is not a built page" % (pid2, href))
    return bad


def group_pages(p, srv, site, codes, urls):
    tools = {e["id"] for e in site.registry if e["template"] == "tool"}
    browser = chromium(p)
    try:
        todo = [(path, c, i) for path, c, i in site.pages if c in codes] + [("/404.html", "en", "404")]
        for path, code, pid in todo:
            for width in ((360, 1280) if code == "en" else (360,)):
                t = Tab(browser, width)
                t0 = now()
                t.page.goto(srv.origin + path, wait_until="load")
                t.page.wait_for_timeout(400)
                t.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                t.page.wait_for_timeout(500)
                info = t.page.evaluate(PAGE_JS)
                bad = list(t.clean())
                if info["scroll"] > info["client"]:
                    bad.append("%d px wide on a %d px screen: %s" % (info["scroll"], info["client"], info["wide"]))
                for mt in info["mounts"]:
                    if not mt["kids"]:
                        bad.append("the %s mount is empty" % mt["tool"])
                    stray = STRAY.findall(mt["text"])
                    if stray:
                        bad.append("the %s mount shows %s" % (mt["tool"], stray))
                audio = srv.since(t0, "/audio/")
                if audio:
                    bad.append("audio before a tap: %s" % audio)
                tag = "referrer=utm_source%%3Dscalita_%s%%26utm_medium%%3Dweb%%26utm_campaign%%3D%s" % (code, pid)
                untagged = [u for u in info["urls"] if u and u.startswith("https://play.google.com/") and tag not in u]
                if untagged:
                    bad.append("Play links not tagged for %s/%s: %s" % (code, pid, untagged))
                extra = ""
                if width == 360:
                    urls.update((u, path) for u in info["urls"])
                    js = sum(gz(r.body()) for r in t.scripts)
                    html = site.html(path)
                    size = gz(html.encode("utf-8"))
                    extra = " (scripts %.1f KB, HTML %.1f KB gzipped)" % (js / 1024, size / 1024)
                    if js > BUDGET:
                        bad.append("scripts before a tap are %d bytes gzipped, over %d" % (js, BUDGET))
                    if pid in tools and size > BUDGET:
                        bad.append("a tool page's HTML is %d bytes gzipped, over %d" % (size, BUDGET))
                    elif size > BUDGET:
                        R.info("%s HTML is %.1f KB gzipped (the 15 KB budget is a tool page's)" % (path, size / 1024))
                    pd = site.page_data(path)
                    if info["mounts"] and pd is None:
                        bad.append("tool mounts but no page data")
                    elif pd is not None:
                        bad += contract(site, pd, html, code, pid, info["mounts"])
                R.check("%s at %d px%s" % (path, width, extra), not bad, bad)
                t.close()
        # The home page's chord: its three notes load on the tap, not before
        t = Tab(browser, 360)
        t.page.goto(srv.origin + "/")
        t.page.wait_for_timeout(300)
        t0 = now()
        t.page.click(".piano-button")
        t.page.wait_for_timeout(800)
        got = sorted(set(srv.since(t0, "/audio/")))
        R.check("the home page's chord loads its three notes on the tap", got == ["/audio/60_C4.mp3", "/audio/64_E4.mp3",
                                                                               "/audio/67_G4.mp3"] and not t.clean(),
                {"audio": got, "console": t.clean()})
        t.close()
    finally:
        browser.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def status(url):
    try:
        return urllib.request.build_opener(NoRedirect).open(url, timeout=15).status
    except urllib.error.HTTPError as e:
        return e.code


def group_links(srv, urls):
    local = {}
    for u, page in urls:
        if not u or u.startswith(("mailto:", "tel:", "#", "data:", "javascript:")):
            continue
        parsed = urlparse(u)
        if parsed.netloc in ("scalita.com", "www.scalita.com") or (not parsed.netloc and u.startswith("/")):
            local.setdefault(parsed.path, page)
        elif not parsed.netloc and not parsed.scheme:
            R.check("%s links %s by a relative URL" % (page, u), False)
    bad = []
    for path, page in sorted(local.items()):
        code = status(srv.origin + path)
        if code != 200:
            bad.append("%s on %s answers %d" % (path, page, code))
    R.check("%d local URLs answer 200 without a redirect" % len(local), not bad, bad)


def group_notfound(p, srv, site):
    html = site.html("/404.html")
    R.check("404.html is noindex", '<meta name="robots" content="noindex">' in html)
    refs = re.findall(r'(?:href|src)="([^"]+)"', html)
    rel = [u for u in refs if not u.startswith(("/", "https://", "http://", "#", "mailto:", "data:"))]
    R.check("404.html names only root-absolute URLs", not rel, rel)
    bad = ["%s %d" % (u, status(srv.origin + u)) for u in sorted({u.split("#")[0] for u in refs if u.startswith("/")})
           if status(srv.origin + u) != 200]
    R.check("every link and asset of 404.html answers 200", not bad, bad)
    browser = chromium(p)
    try:
        t = Tab(browser, 360)
        deep = "/es/no-such-section/no-such-page/"
        resp = t.page.goto(srv.origin + deep)
        t.page.wait_for_timeout(400)
        sub = [b for b in t.bad if deep not in b]
        logs = [x for x in t.logs if "404" not in x]
        styled = t.page.evaluate("getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'")
        R.check("a missing deep URL answers 404 with the page, styled, nothing else missing",
                resp.status == 404 and t.page.locator(".notfound").count() == 1 and styled and not sub and not logs,
                {"status": resp.status, "failed": sub, "console": logs, "styled": styled})
        t.close()
    finally:
        browser.close()


def group_langbar(p, srv, site):
    said = re.search(r"var said = (\{.*?\});\n", site.html("/"))  # what the built page's script offers
    es = json.loads(said.group(1))["es"]
    browser = chromium(p)
    try:
        t = Tab(browser, 360, locale="es-ES")
        t.page.goto(srv.origin + "/")
        bar = t.page.locator(".lang-bar")
        bar.wait_for(timeout=5000)
        link = bar.locator("a")
        R.check("a Spanish browser on the English home gets the bar in Spanish, to /es/",
                link.inner_text() == es["text"] and link.get_attribute("href") == "/es/" and bar.get_attribute("lang") == "es"
                and bar.get_attribute("data-nosnippet") is not None,
                [link.inner_text(), link.get_attribute("href"), bar.get_attribute("lang")])
        R.check("the bar's close button is labelled in Spanish", bar.locator("button").get_attribute("aria-label") == es["close"],
                bar.locator("button").get_attribute("aria-label"))
        over = t.page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        R.check("the bar fits 360 px", over <= 0, over)
        bar.locator("button").click()
        gone = t.page.locator(".lang-bar").count() == 0
        t.page.reload()
        t.page.wait_for_timeout(500)
        R.check("closed, it is gone and stays gone after a reload",
                gone and t.page.locator(".lang-bar").count() == 0, t.page.evaluate("localStorage.getItem('scalita-lang-choice')"))
        t.page.goto(srv.origin + "/es/")
        t.page.wait_for_timeout(300)
        R.check("no bar on the page in the browser's own language", t.page.locator(".lang-bar").count() == 0)
        R.check("console clean", not t.clean(), t.clean())
        t.close()
        t = Tab(browser, 360, locale="en-US")
        t.page.goto(srv.origin + "/")
        t.page.wait_for_timeout(500)
        R.check("an English browser on the English home gets no bar", t.page.locator(".lang-bar").count() == 0)
        t.close()
        # A tool page offers Spanish only once it exists in Spanish
        path = site.url("vocal-range-test")
        if path:
            exists = site.url("vocal-range-test", "es") is not None
            t = Tab(browser, 360, locale="es-ES")
            t.page.goto(srv.origin + path)
            t.page.wait_for_timeout(500)
            n = t.page.locator(".lang-bar").count()
            R.check("the range test offers Spanish %s" % ("(it exists in es)" if exists else "never (no es page yet)"),
                    n == (1 if exists else 0), n)
            t.close()
    finally:
        browser.close()


# Each MP3 as the browser decodes it; onset is the first sample over 0.01,
# render_web_piano.py's definition
DECODE_JS = """async (files) => {
  const C = window.AudioContext || window.webkitAudioContext;
  const ctx = new C();
  const out = {};
  for (const f of files) {
    try {
      const buf = await (await fetch(f.url)).arrayBuffer();
      const a = await new Promise((ok, no) => { const p = ctx.decodeAudioData(buf, ok, no); if (p && p.catch) p.catch(no); });
      const d = a.getChannelData(0);
      let peak = 0, onset = -1;
      for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); if (x > peak) peak = x; if (onset < 0 && x > 0.01) onset = i; }
      out[f.file] = { seconds: a.duration, rate: a.sampleRate, channels: a.numberOfChannels, peak, onsetMs: onset / a.sampleRate * 1000 };
    } catch (e) { out[f.file] = { error: String(e) }; }
  }
  if (ctx.close) ctx.close();
  return out;
}"""


def decode_files(site):
    m = manifest(site)
    return [{"file": n["file"], "url": "/audio/piano-web/%s?v=%s" % (n["file"], n["sha256"][:10])} for n in m["notes"]]


def ffmpeg_onsets(site):
    """Each file's onset in ms as ffmpeg decodes it, or None without ffmpeg."""
    try:
        spec = importlib.util.spec_from_file_location("render_web_piano", REPO / "tool" / "render_web_piano.py")
        render = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(render)
        ff = render.find_ffmpeg()
        return {n["file"]: render.onset(render.decode(ff, site.root / "audio" / "piano-web" / n["file"])) / render.RATE * 1000
                for n in manifest(site)["notes"]}
    except Exception as e:  # no ffmpeg: durations and levels still count
        R.info("no ffmpeg onsets (%s)" % str(e).splitlines()[0])
        return None


def judge_decode(engine, got, site, onsets, seconds_tol, onset_tol):
    files = sorted(n["file"] for n in manifest(site)["notes"])
    on_disk = sorted(f.name for f in (site.root / "audio" / "piano-web").glob("*.mp3"))
    if engine == "chromium":
        R.check("the manifest lists every MP3 in audio/piano-web, and only those", files == on_disk,
                {"manifest only": sorted(set(files) - set(on_disk)), "disk only": sorted(set(on_disk) - set(files))})
    bad = []
    worst = [0.0, 0.0]
    for f in files:
        d = got.get(f) or {"error": "not decoded"}
        if "error" in d:
            bad.append("%s: %s" % (f, d["error"]))
            continue
        worst[0] = max(worst[0], abs(d["seconds"] - 5.0))
        if abs(d["seconds"] - 5.0) > seconds_tol or d["channels"] != 1 or not 0.2 < d["peak"] < 1.0:
            bad.append("%s: %.4f s, %d channels, peak %.3f" % (f, d["seconds"], d["channels"], d["peak"]))
        if onsets:
            off = d["onsetMs"] - onsets[f]
            worst[1] = max(worst[1], abs(off))
            if abs(off) > onset_tol:
                bad.append("%s: attack %.2f ms from ffmpeg's" % (f, off))
    R.check("%s decodes all %d MP3s, 5 s within %g s%s" % (
        engine, len(files), seconds_tol, ", the attack within %g ms of ffmpeg's" % onset_tol if onsets else ""),
        not bad, bad)
    R.info("%s: worst length %.1f ms off 5 s, worst attack %.2f ms off ffmpeg's" % (engine, worst[0] * 1000, worst[1]))


def group_decode(p, srv, site, onsets):
    browser = chromium(p)
    try:
        t = Tab(browser, 360)
        t.page.goto(srv.origin + "/404.html")
        got = t.page.evaluate(DECODE_JS, decode_files(site))
        judge_decode("chromium", got, site, onsets, 0.002, 1.0)
        R.check("console clean", not t.clean(), t.clean())
        t.close()
    finally:
        browser.close()


# ---------------------------------------------------------------------------
# the tools on their pages


def takes_dir():
    fx = json.loads((REPO / "tool" / "tests" / "range-test" / "fixtures.json").read_text(encoding="utf-8"))
    d = os.environ.get("SCALITA_TAKES") or str((REPO / "tool" / "tests" / "range-test" / fx["takesDir"]).resolve())
    return Path(d) if os.path.isdir(d) else None


def compose(segments, path, takes, rate=44100):
    """tool/tests/range-test/fixtures.json's segments as one 16-bit mono WAV."""
    out = bytearray()
    for s in segments:
        if "silence" in s:
            out += b"\0\0" * round(s["silence"] * rate)
        elif "hz" in s:
            n, ramp = round(s["sec"] * rate), round(0.01 * rate)
            out += b"".join(struct.pack("<h", round(32767 * 0.3 * math.sin(2 * math.pi * s["hz"] * i / rate)
                                                     * min(1, i / ramp, (n - 1 - i) / ramp))) for i in range(n))
        else:
            with wave.open(str(takes / s["take"]), "rb") as w:
                assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (rate, 1, 2), s["take"]
                pcm = w.readframes(w.getnframes())
            a = round(s.get("from", 0) * rate) * 2
            b = len(pcm) if s.get("to") is None else round(s["to"] * rate) * 2
            out += pcm[a:b]
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(out))
    return len(out) / 2 / rate


def tone(path, hz, seconds=70.0, rate=44100):
    """A hummed note: hz and three harmonics, silence around it (after
    %noloop Chrome repeats its last buffer, so the file ends quiet)."""
    if path.exists():
        return path
    w = 2 * math.pi * hz / rate
    body = b"".join(struct.pack("<h", int(9000 * (math.sin(i * w) + 0.5 * math.sin(2 * i * w) + 0.25 * math.sin(3 * i * w)
                                                  + 0.12 * math.sin(4 * i * w)))) for i in range(int(seconds * rate)))
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(b"\0\0" * int(0.3 * rate) + body + b"\0\0" * int(2 * rate))
    return path


def check_versioned(t, pd, srv, since):
    """Every script the page has loaded so far, its own imports, the engines
    it fetched after a tap and the capture worklet (which only the server
    sees) included, carries the ?v= of page data."""
    assets = pd.get("assets") or {}
    names = t.page.evaluate("performance.getEntriesByType('resource').map((e) => e.name)") + [u for _, u, _ in t.requests] \
        + [srv.origin + r for r in srv.raw_since(since, "/js/")]
    bad, seen = [], set()
    for name in names:
        u = urlparse(name)
        if u.path.startswith("/js/"):
            seen.add(u.path)
            if assets.get(u.path) != u.path + ("?" + u.query if u.query else ""):
                bad.append(name)
    R.check("every script loaded carries its ?v= version (%d files)" % len(seen), seen and not bad, bad)


RANGE_RESULT = """() => {
  const el = document.querySelector('[data-tool="vocal-range-test"] .tool-panel__state--result');
  const a = el.querySelector('.callout a');
  return { value: (el.querySelector('.result-card__value') || {}).textContent || '',
           cta: (el.querySelector('.callout p') || {}).textContent || '', play: a ? a.getAttribute('href') : null };
}"""


def group_range(p, srv, site):
    path = site.url("vocal-range-test")
    if not path:
        return R.skip("the vocal range test page is not built")
    takes = takes_dir()
    if not takes:
        return R.skip("no takes folder (set SCALITA_TAKES)")
    fx = json.loads((REPO / "tool" / "tests" / "range-test" / "fixtures.json").read_text(encoding="utf-8"))["twoTakes"]
    wav = scratch() / "range-two-takes.wav"
    seconds = compose(fx["segments"], wav, takes)
    pd = site.page_data(path)
    U, C = pd["strings"]["vocal-range-test"], pd["strings"]["common"]
    mount = '[data-tool="vocal-range-test"]'
    browser = chromium(p, wav)
    try:
        t = Tab(browser, 360, ua=ANDROID, init=[EVENTS, PROBE % "{}"])
        t0 = now()
        t.page.goto(srv.origin + path)
        t.page.wait_for_selector(mount + '[data-state="idle"]')
        t.page.get_by_role("button", name=C["start"], exact=True).click()
        t.page.wait_for_function("window.__ev.some((e) => e.phase === 'done')", timeout=int((seconds + 30) * 1000))
        ev = [e for e in t.page.evaluate("window.__ev") if e["event"] == "rangetest"]
        done = next(e for e in ev if e["phase"] == "done")
        R.check("two takes lock %s and %s" % (label(pd, fx["low"]), label(pd, fx["high"])),
                (done["low"], done["high"]) == (fx["low"], fx["high"]), [done["low"], done["high"]])
        on = next((e["at"] for e in ev if e.get("micOn")), None)
        off = next((e["at"] for e in ev if on is not None and e["at"] > on and not e.get("micOn")), None)
        R.check("the microphone went on, and off at the second lock", on and off, [on, off])
        if on and off:
            seen = t.page.evaluate("([a, b]) => performance.getEntriesByType('resource').filter((e) => "
                                   "performance.timeOrigin + e.startTime >= a && performance.timeOrigin + e.startTime <= b)"
                                   ".map((e) => e.name)", [on, off])
            R.check("the page starts no fetch while it listens", not seen, seen)
            live_checks(t, srv, [[on, off]], t.page.evaluate(PROBED)["spans"])
        s = t.page.evaluate("document.querySelector('%s').rangeTest.settings" % mount) or {}
        R.check("echoCancellation, noiseSuppression and autoGainControl off",
                [s.get(k) for k in ("echoCancellation", "noiseSuppression", "autoGainControl")] == [False] * 3, s)
        R.check("the track is stopped", t.page.evaluate("document.querySelector('%s').rangeTest.micLive()" % mount) is False)
        t.page.get_by_role("button", name=U["seeResult"]).click()
        t.page.wait_for_selector(mount + '[data-state="result"]')
        r = t.page.evaluate(RANGE_RESULT)
        local = lambda m: pd["notes"][str(m)][0]
        R.check("the result names the range", r["value"].startswith(fill(U["rangeValue"], low=local(fx["low"]), high=local(fx["high"]))),
                r["value"])
        rng = fill(U["rangeValue"], low=label(pd, fx["low"]), high=label(pd, fx["high"]))
        cta = t.page.locator(mount + " .tool-panel__state--result .callout a")
        R.check("Android: the CTA and the tagged Play link, visible",
                r["cta"] == fill(U["ctaAndroid"], range=rng) and r["play"] == pd["playLink"]
                and "utm_campaign%3Dvocal-range-test" in r["play"] and cta.is_visible(), r)
        over = t.page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        R.check("the result fits 360 px", over <= 0, over)
        save = t.page.get_by_role("button", name=C["save"], exact=True)
        with t.page.expect_download(timeout=10000) as dl:
            save.click(timeout=10000)  # waits for the card to be drawn
        f = dl.value.path()
        png = Path(f).read_bytes()[:8] if f else b""
        R.check("the share card saves as a PNG", dl.value.suggested_filename.endswith(".png") and png == b"\x89PNG\r\n\x1a\n",
                [dl.value.suggested_filename, len(Path(f).read_bytes()) if f else 0])
        check_versioned(t, pd, srv, t0)
        R.check("console clean", not t.clean(), t.clean())
        t.close()

        t = Tab(browser, 360, ua=INSTAGRAM)
        t.page.goto(srv.origin + path)
        t.page.wait_for_selector(mount + "[data-state]")
        text = t.page.locator(mount).inner_text()
        role = lambda n, exact=False: t.page.get_by_role("button", name=n, exact=exact).count()
        R.check("an in-app browser: open in your browser, copy link, the keyboard, no Start",
                C["openInBrowser"] in text and role(C["copyLink"]) == 1 and role(U["noMic"]) == 1
                and role(C["start"], True) == 0, text[:300])
        R.check("in-app: console clean", not t.clean(), t.clean())
        t.close()
    finally:
        browser.close()


# Runs before any page script: every microphone track's live span, the
# spans the tool shows it is listening (its --listening class), and every
# piano voice, watched from outside the tool, on the epoch clock
PROBE = """(() => {
  window.__scalitaTest = Object.assign({ events: [] }, %s);
  const at = () => performance.timeOrigin + performance.now();
  const P = window.__probe = { gum: 0, spans: [], listening: [], violations: [] };
  const tracks = [];
  P.live = () => tracks.some((t) => t.readyState === 'live');
  let open = null;
  new MutationObserver(() => {
    const on = !!document.querySelector('.tool-panel__state--listening');
    if (on && !open) P.listening.push((open = [at(), null]));
    if (!on && open) { open[1] = at(); open = null; }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      P.gum++;
      const s = await orig(c);
      for (const t of s.getAudioTracks()) {
        const span = [at(), null];
        P.spans.push(span);
        tracks.push(t);
        const end = () => { if (span[1] === null) span[1] = at(); };
        t.addEventListener('ended', end);
        const stop = t.stop.bind(t);
        t.stop = () => { end(); stop(); };
      }
      return s;
    };
  }
  const voices = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...rest) {
    if (this.buffer && this.buffer.length > 1) {  // not the one-sample unlock
      const c = this.context, from = Math.max(when || 0, c.currentTime);
      voices.push({ node: this, c, to: from + this.buffer.duration / (this.playbackRate.value || 1) });
      if (P.live()) P.violations.push('a piano voice started while the microphone was live');
    }
    return start.call(this, when, ...rest);
  };
  const stopNode = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (when) {
    for (const v of voices) if (v.node === this) v.to = Math.min(v.to, Math.max(when || 0, v.c.currentTime));
    return stopNode.call(this, when);
  };
  setInterval(() => {
    if (!P.live()) return;
    for (const v of voices) if (v.c.state !== 'closed' && v.c.currentTime < v.to - 0.003) {
      P.violations.push('a piano voice was still sounding while the microphone was live');
      v.to = 0;
    }
  }, 2);
})();"""


PROBED = """({ violations: window.__probe.violations, live: window.__probe.live(), gum: window.__probe.gum,
  spans: window.__probe.spans.map((s) => [s[0], s[1] === null ? 1e15 : s[1]]),
  listening: window.__probe.listening.map((s) => [s[0], s[1] === null ? 1e15 : s[1]]) })"""


def live_checks(t, srv, listening, spans):
    """Nothing reaches the server while the tool listens, nor while any
    microphone track is live (the capture worklet loads before the first
    track opens), and nothing all session but GETs of the site's own files.
    The server's log is the witness: a worklet's fetch never shows in the
    page's resource timing."""
    during = [x for a, b in listening for x in srv.between(a, b)]
    R.check("no request reaches the server while the tool listens (%d spans)" % len(listening),
            listening and not during, during if listening else "no listening span seen")
    live = [x for a, b in spans for x in srv.between(a, b)]
    R.check("none while any microphone track is live (%d tracks)" % len(spans), spans and not live,
            live if spans else "no track seen")
    R.check("nothing sent all session: GETs of the site's own files only", not t.sent(srv.origin), t.sent(srv.origin))


def group_tune(p, srv, site):
    path = site.url("sing-in-tune-test")
    if not path:
        return R.skip("the sing-in-tune page is not built")
    pd = site.page_data(path)
    U, C = pd["strings"]["sing-in-tune-test"], pd["strings"]["common"]
    wav = tone(scratch() / "tone-a4.wav", 440.0)
    targets = [57, 69, 57, 69, 57]
    browser = chromium(p, wav)
    try:
        t = Tab(browser, 360, ua=ANDROID, init=[PROBE % json.dumps({"targets": targets, "seed": 7})])
        t0 = now()
        t.page.goto(srv.origin + path)
        t.page.wait_for_selector(".tool-panel__state--idle:not([hidden]) .chip")
        mode = t.page.get_attribute('.chip[aria-pressed="true"]', "data-mode")
        R.check("the page opens on sing this note", mode == "sing", mode)
        t.page.click('.tool-panel__state--idle:not([hidden]) button >> text="%s"' % C["start"])
        t.page.wait_for_selector(".tool-panel__state--result:not([hidden])", timeout=120000)
        r = t.page.evaluate("""() => {
          const r = document.querySelector('.tool-panel__state--result:not([hidden])');
          const a = r.querySelector('a.btn-primary');
          return { value: r.querySelector('.result-card__value').textContent,
                   facts: Object.fromEntries([...r.querySelectorAll('.result-card__facts > div')].map((d) =>
                     [d.querySelector('dt').textContent, d.querySelector('dd').textContent])),
                   href: a ? a.getAttribute('href') : null };
        }""")
        m = re.match(r"([+-]?\d+)", r["value"].replace("\u2212", "-"))  # a minus sign, or a hyphen
        R.check("a steady A4 sung back to A3 and A4 reads within 2 cents", m and abs(int(m.group(1))) <= 2, r["value"])
        five = fill(U["result"]["count"], n=5, total=5)
        R.check("five of five within 10 cents", r["facts"].get(U["result"]["within10"]) == five, r["facts"])
        shown = t.page.inner_text(".tool-panel__state--result:not([hidden])")
        R.check("the result prints no null (a perfect round has no line under the figure)",
                not re.search(r"\bnull\b", shown), shown[:200])
        probe = t.page.evaluate(PROBED)
        R.check("the piano and the microphone never at once", not probe["violations"], probe["violations"])
        R.check("one microphone check, then one opening per note", probe["gum"] == len(targets) + 1, probe["gum"])
        live_checks(t, srv, probe["listening"], probe["spans"])
        R.check("the microphone is off at the end", not probe["live"])
        R.check("Android: the tagged Play link", r["href"] == pd["playLink"] and "utm_campaign%3Dsing-in-tune-test" in (r["href"] or ""),
                r["href"])
        check_versioned(t, pd, srv, t0)
        R.check("console clean", not t.clean(), t.clean())
        t.close()
    finally:
        browser.close()


def play_until_end(t, timeout=180000):
    t.page.wait_for_function("window.__ev.some((e) => e.event === 'scalita:player' && e.type === 'end')", timeout=timeout)
    return [e for e in t.page.evaluate("window.__ev") if e["event"] == "scalita:player"]


def group_player(p, srv, site):
    routines = {r["id"]: r for r in data("routines.json")}
    scales = {s["id"]: s for s in data("scales.json")}
    browser = chromium(p)
    try:
        path = site.url("quick-vocal-warm-up")
        if not path:
            R.skip("the quick warm-up page is not built")
        else:
            rid = site.by_id["quick-vocal-warm-up"]["data"]["routineId"]
            pd = site.page_data(path)
            t = Tab(browser, 360, init=[EVENTS, FAST])
            t0 = now()
            t.page.goto(srv.origin + path)
            t.page.wait_for_selector('[data-tool="player"] .player__preset')
            t.page.wait_for_timeout(300)
            R.check("quick warm-up page: nothing under /audio/ before Play", not srv.since(t0, "/audio/"), srv.since(t0, "/audio/"))
            t.page.click('[data-tool="player"] .player__preset[data-voice="tenor"]')
            t1 = now()
            t.page.click('[data-tool="player"] .btn-primary')
            ev = play_until_end(t)
            keys = [[e["step"], e["root"]] for e in ev if e["type"] == "key"]
            want = [[i, r] for i, roots in enumerate(routines[rid]["presets"]["tenor"]["roots"]) for r in roots]
            R.check("quick warm-up page: %s for the tenor preset plays the export's roots in order" % rid, keys == want,
                    {"got": keys[:10], "want": want[:10], "n": [len(keys), len(want)]})
            audio = srv.since(t1, "/audio/")
            R.check("quick warm-up page: after Play, piano samples only", audio and all(
                a.startswith("/audio/piano-web/") and a.endswith(".mp3") for a in audio), audio)
            R.check("quick warm-up page: Play again at the end",
                    t.page.text_content('[data-tool="player"] .btn-primary') == pd["strings"]["common"]["play"])
            check_versioned(t, pd, srv, t0)
            R.check("quick warm-up page: console clean", not t.clean(), t.clean())
            t.close()

        path = site.url("warm-up-piano")
        if not path:
            return R.skip("the warm-up piano page is not built")
        t = Tab(browser, 360, init=[EVENTS, FAST])
        t.page.goto(srv.origin + path)
        t.page.wait_for_selector('[data-tool="player"] .player__preset')
        chosen = t.page.eval_on_selector('[data-tool="player"] select', "s => s.value")
        R.check("warm-up piano: opens on the five-note scale", chosen == "scale:five_note", chosen)
        t.page.click('[data-tool="player"] .player__preset[data-voice="soprano"]')
        t.page.click('[data-tool="player"] .btn-primary')
        ev = play_until_end(t)
        roots = [e["root"] for e in ev if e["type"] == "key"]
        want = scales["five_note"]["presets"]["soprano"]["roots"]
        R.check("warm-up piano: the five-note scale for soprano plays the export's roots", roots == want,
                {"got": roots, "want": want})
        options = t.page.eval_on_selector_all('[data-tool="player"] select option', "o => o.map((x) => x.value)")
        R.check("warm-up piano: the chooser holds the routines and scales that have pages",
                "routine:pre_performance" in options and "scale:five_note" in options, options)
        t.page.select_option('[data-tool="player"] select', "routine:pre_performance")
        n = t.page.eval_on_selector_all('[data-tool="player"] .player__steps li', "x => x.length")
        R.check("warm-up piano: a routine shows its steps", n == len(routines["pre_performance"]["steps"]), n)
        R.check("warm-up piano: console clean", not t.clean(), t.clean())
        t.close()
    finally:
        browser.close()


def group_finder(p, srv, site):
    path = site.url("voice-break-finder")
    if not path:
        return R.skip("the voice break finder page is not built")
    pd = site.page_data(path)
    U = pd["strings"]["voice-break-finder"]
    vectors = data("voice_type_vectors.json")["closestForPrimoAndGender"]
    browser = chromium(p)
    try:
        t = Tab(browser, 360, init=[EVENTS, FAST])
        t0 = now()
        t.page.goto(srv.origin + path)
        mount = '[data-tool="voice-break-finder"]'
        t.page.wait_for_selector(mount + '[data-state="intro"]')
        R.check("nothing fetched under /audio/ before an answer", not srv.since(t0, "/audio/"))
        t.page.click(mount + " .btn-primary")
        t.page.wait_for_selector(mount + '[data-state="voice"]')
        t.page.get_by_role("button", name=U["lowerVoice"]).click()
        t.page.wait_for_function("window.__ev.filter((e) => e.type === 'note').length >= 5", timeout=30000)
        t.page.get_by_role("button", name=U["feltIt"]).click()
        t.page.wait_for_selector(mount + '[data-state="confirming"]')
        t.page.get_by_role("button", name=U["yes"]).click()
        t.page.wait_for_selector(mount + '[data-state="result"]')
        ev = t.page.evaluate("window.__ev")
        felt = next(e["midi"] for e in ev if e.get("type") == "felt")
        res = next(e for e in ev if e.get("type") == "result")
        want = next(v["type"] for v in vectors if v["primo"] == res["primo"] and v["isMaleVoice"])
        R.check("the result is the felt note and voice_type.dart's type", res["primo"] == felt and res["voiceType"] == want,
                [res, felt, want])
        saved = t.page.evaluate("JSON.parse(localStorage.getItem('scalita-voice-break'))")
        R.check("kept in this browser", saved and saved.get("primo") == res["primo"], saved)
        text = t.page.locator(mount).inner_text()
        R.check("the result names the note", pd["notes"][str(res["primo"])][0] in text, text[:300])
        check_versioned(t, pd, srv, t0)
        R.check("console clean", not t.clean(), t.clean())
        piano = site.url("warm-up-piano")
        if piano:
            t.page.goto(srv.origin + piano)
            t.page.click('[data-tool="player"] .player__preset[data-voice="tenor"]')
            meta = t.page.text_content('[data-tool="player"] .player__meta')
            P = site.page_data(piano)["strings"]["player"]
            R.check("the warm-up piano is built around the break it found",
                    fill(P["usingBreak"], note=label(pd, res["primo"])) in meta, meta)
        t.close()
    finally:
        browser.close()


# Each tool's quickest way to its result, with no microphone: what every
# locale's strings are checked on


def drive_range(t, pd):
    U, C, m = pd["strings"]["vocal-range-test"], pd["strings"]["common"], '[data-tool="vocal-range-test"]'
    t.page.wait_for_selector(m + '[data-state="idle"]')
    t.page.get_by_role("button", name=U["noMic"], exact=True).click()
    t.page.get_by_role("button", name=U["lowerKeys"], exact=True).click()
    t.page.click(m + ' .tool-panel__state--manual .keyboard [data-midi="45"]')
    t.page.get_by_role("button", name=C["next"], exact=True).click()
    t.page.click(m + ' .tool-panel__state--manual .keyboard [data-midi="64"]')
    t.page.get_by_role("button", name=U["showRange"], exact=True).click()
    t.page.wait_for_selector(m + '[data-state="result"]')
    return m


def drive_ear(t, pd):
    U, C, m = pd["strings"]["sing-in-tune-test"], pd["strings"]["common"], '[data-tool="sing-in-tune-test"]'
    t.page.wait_for_selector(".tool-panel__state--idle:not([hidden]) .chip")
    t.page.click('.chip[data-mode="ear"]')
    t.page.click('.tool-panel__state--idle:not([hidden]) button >> text="%s"' % C["start"])
    for _ in range(3):
        t.page.get_by_role("button", name=U["ear"]["higher"], exact=True).click(timeout=15000)  # waits until enabled
        t.page.get_by_role("button", name=C["next"], exact=True).click(timeout=5000)
    t.page.wait_for_selector(".tool-panel__state--result:not([hidden])", timeout=15000)
    return m


def drive_finder(t, pd):
    U, m = pd["strings"]["voice-break-finder"], '[data-tool="voice-break-finder"]'
    t.page.wait_for_selector(m + '[data-state="intro"]')
    t.page.click(m + " .btn-primary")
    t.page.get_by_role("button", name=U["lowerVoice"], exact=True).click()
    t.page.wait_for_function("window.__ev.filter((e) => e.type === 'note').length >= 3", timeout=30000)
    t.page.get_by_role("button", name=U["feltIt"], exact=True).click()
    t.page.get_by_role("button", name=U["yes"], exact=True).click()
    t.page.wait_for_selector(m + '[data-state="result"]')
    return m


def drive_piano(t, pd):
    m = '[data-tool="player"]'
    t.page.wait_for_selector(m + " .player__preset")
    t.page.click(m + ' .player__preset[data-voice="soprano"]')
    t.page.click(m + " .btn-primary")
    play_until_end(t, 60000)
    return m


def group_locales(p, srv, site):
    """Every tool in every other locale it is built in, to its result."""
    drives = (("vocal-range-test", drive_range), ("sing-in-tune-test", drive_ear),
              ("voice-break-finder", drive_finder), ("warm-up-piano", drive_piano))
    browser = chromium(p)
    try:
        for code in [c for c in site.locales() if c != "en"]:
            for pid, drive in drives:
                path = site.url(pid, code)
                if not path:
                    continue
                pd = site.page_data(path)
                t = Tab(browser, 360, locale=pd["lang"], init=[EVENTS, FAST])
                try:
                    t.page.goto(srv.origin + path)
                    m = drive(t, pd)
                    text = t.page.locator(m).inner_text()
                    over = t.page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                    bad = t.clean() + (["shows %s" % STRAY.findall(text)] if STRAY.search(text) else []) \
                        + (["%d px too wide" % over] if over > 0 else [])
                    R.check("%s: to its result, nothing stray, fits 360 px, console clean" % path, not bad, bad)
                except Exception as e:
                    R.check("%s: to its result" % path, False, "%s: %s" % (type(e).__name__, str(e).splitlines()[0]))
                t.close()
    finally:
        browser.close()


# ---------------------------------------------------------------------------
# Firefox, through geckodriver (no Playwright build of Firefox is needed)


class Gecko:
    """Just enough WebDriver for geckodriver: a session, a page, scripts,
    clicks, and the page's console (Firefox prints it to its stdout)."""

    def __init__(self, exe, prefs):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        self.base = "http://127.0.0.1:%d" % port
        self.proc = subprocess.Popen([exe, "--port", str(port), "--log", "info"], stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True, errors="replace")
        self.lines = []
        threading.Thread(target=lambda: [self.lines.append(x) for x in self.proc.stdout], daemon=True).start()
        for _ in range(200):
            try:
                self.call("GET", "/status")
                break
            except Exception:
                time.sleep(0.05)
        caps = {"capabilities": {"alwaysMatch": {"browserName": "firefox", "moz:firefoxOptions": {
            "args": ["-headless"], "prefs": prefs}}}}
        self.sid = self.call("POST", "/session", caps)["sessionId"]
        self.version = self.version_of()
        self.call("POST", self.s("/timeouts"), {"script": 180000, "pageLoad": 60000})

    def s(self, path):
        return "/session/%s%s" % (self.sid, path)

    def call(self, method, path, body=None):
        req = urllib.request.Request(self.base + path, method=method, headers={"Content-Type": "application/json"},
                                     data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.loads(r.read())["value"]
        except urllib.error.HTTPError as e:
            raise RuntimeError("geckodriver: %s" % e.read().decode(errors="replace")[:400])

    def version_of(self):
        return self.js("return navigator.userAgent").rsplit("/", 1)[-1]

    def go(self, url):
        self.call("POST", self.s("/url"), {"url": url})

    def js(self, script, *args):
        return self.call("POST", self.s("/execute/sync"), {"script": script, "args": list(args)})

    def ajs(self, body, *args):
        """An async script: body is a function source called with args."""
        src = "const done = arguments[arguments.length - 1]; Promise.resolve((%s)(...[...arguments].slice(0, -1)))" \
              ".then(done, (e) => done({ error: String(e) }));" % body
        return self.call("POST", self.s("/execute/async"), {"script": src, "args": list(args)})

    def click(self, xpath):
        el = self.call("POST", self.s("/element"), {"using": "xpath", "value": xpath})
        self.call("POST", self.s("/element/%s/click" % list(el.values())[0]), {})

    def wait(self, expr, timeout=20.0):
        end = time.time() + timeout
        while time.time() < end:
            v = self.js("return (%s)" % expr)
            if v:
                return v
            time.sleep(0.1)
        return None

    def console(self, origin, mark):
        out = []
        for x in self.lines[mark:]:
            x = x.rstrip()
            if x.startswith(("console.error:", "console.warn:")) or (x.startswith("JavaScript error:") and origin in x) \
                    or (x.startswith("JavaScript warning:") and origin in x):
                out.append(x)
        return out

    def close(self):
        try:
            self.call("DELETE", self.s(""))
        except Exception:
            pass
        self.proc.terminate()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def group_firefox(srv, site, onsets):
    exe = shutil.which("geckodriver") or ("/snap/bin/geckodriver" if os.path.exists("/snap/bin/geckodriver") else None)
    if not exe:
        return R.skip("no geckodriver on PATH")
    prefs = {"media.navigator.streams.fake": True, "media.navigator.permission.disabled": True,
             "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0, "media.volume_scale": "0.0",
             "devtools.console.stdout.content": True, "devtools.console.stdout.chrome": False,
             "intl.accept_languages": "en-US"}
    try:
        ff = Gecko(exe, prefs)
    except Exception as e:
        return R.skip("Firefox did not start: %s" % str(e).splitlines()[0])
    R.info("Firefox %s" % ff.version)
    try:
        ff.call("POST", ff.s("/window/rect"), {"width": 360, "height": 800})
        width = ff.js("return document.documentElement.clientWidth")
        for path in [x for x, c, _ in site.pages if c == "en"] + ["/404.html"]:
            mark, t0 = len(ff.lines), now()
            ff.go(srv.origin + path)
            filled = ff.wait("[...document.querySelectorAll('[data-tool]')].every((el) => [...el.children].some((c) =>"
                             " c.tagName !== 'NOSCRIPT'))")
            time.sleep(0.3)
            over = ff.js("return document.documentElement.scrollWidth - document.documentElement.clientWidth")
            bad = ff.console(srv.origin, mark) + srv.errors_since(t0)
            audio = srv.since(t0, "/audio/")
            R.check("%s: tools mounted, nothing missing, no console error, no audio before a tap, fits %d px"
                    % (path, width), filled and not bad and not audio and over <= 0,
                    {"filled": filled, "console": bad, "audio": audio, "overflow": over})

        path = site.url("sing-in-tune-test")
        if path:
            pd = site.page_data(path)
            U, C = pd["strings"]["sing-in-tune-test"], pd["strings"]["common"]
            mark = len(ff.lines)
            ff.go(srv.origin + path)
            ff.wait("document.querySelector('.chip[data-mode=\"tuner\"]')")
            ff.click("//button[@data-mode='tuner']")
            ff.click("//div[contains(@class,'tool-panel__state--idle') and not(@hidden)]//button[normalize-space()=%s]"
                     % json.dumps(C["start"]))
            # 1 kHz is B5 and 21 cents
            name = ff.wait("(() => { const n = document.querySelector('.note-target__name');"
                           " return n && n.textContent.trim() === %s ? n.textContent : null; })()"
                           % json.dumps(pd["notes"]["83"][0]), timeout=20)
            time.sleep(2.0)
            readout = ff.js("const p = document.querySelector('.tool-panel__state--run:not([hidden]) .note-target + .pitch-trail + p');"
                            " return p ? p.textContent : null") or ""
            unit = U["units"]["cents"]["other"].replace("{n}", r"(\d+)")
            m = re.match("^%s$" % U["offset"]["high"].replace("{cents}", unit), readout)
            R.check("the free tuner reads Firefox's fake tone as %s, about 21 cents sharp" % pd["notes"]["83"][0],
                    name and m and 17 <= int(m.group(1)) <= 25, [name, readout])
            ff.click("//div[contains(@class,'tool-panel__state--run') and not(@hidden)]//button[normalize-space()=%s]"
                     % json.dumps(C["stop"]))
            back = ff.wait("document.querySelector('.tool-panel__state--idle:not([hidden])')")
            R.check("Stop brings the idle panel back, console clean", back and not ff.console(srv.origin, mark),
                    ff.console(srv.origin, mark))

        path = site.url("warm-up-piano")
        if path:
            mark, t0 = len(ff.lines), now()
            ff.go(srv.origin + path)
            ff.wait("document.querySelector('[data-tool=\"player\"] .player__preset')")
            ff.js("window.__ev = []; document.querySelector('[data-tool=\"player\"]').addEventListener('scalita:player',"
                  " (e) => window.__ev.push(e.detail));")
            ff.click("//button[@data-voice='soprano']")
            ff.click("//div[@data-tool='player']//button[contains(@class,'btn-primary')]")
            notes = ff.wait("window.__ev.filter((e) => e.type === 'note').length >= 4", timeout=30)
            first = ff.js("return window.__ev.filter((e) => e.type === 'key').map((e) => e.root)")
            ff.click("//div[@data-tool='player']//button[contains(@class,'btn-primary')]")
            want = data("scales.json")
            want = next(s for s in want if s["id"] == "five_note")["presets"]["soprano"]["roots"]
            audio = srv.since(t0, "/audio/")
            R.check("the warm-up piano plays the soprano five-note scale from its first root",
                    notes and first and first == want[:len(first)] and audio
                    and all(a.startswith("/audio/piano-web/") for a in audio) and not ff.console(srv.origin, mark),
                    {"keys": first, "audio": audio[:4], "console": ff.console(srv.origin, mark)})

        # Firefox 158 drops the decoder's delay but not LAME's encoder delay
        # and padding: every attack lands 13 ms late, all by the same amount,
        # so a chord stays together and nothing a singer hears moves
        ff.go(srv.origin + "/404.html")
        got = ff.ajs(DECODE_JS, decode_files(site))
        judge_decode("firefox", got, site, onsets, 0.06, 30.0)
    finally:
        ff.close()


# ---------------------------------------------------------------------------
# WebKit, through Node and a playwright-core whose WebKit is installed


def webkit_core():
    """A playwright-core package whose WebKit build is installed: the one
    SCALITA_PLAYWRIGHT_CORE names, Playwright for Python's own driver, or one
    in a Node project or npx cache on this machine."""
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


def group_webkit(srv, site, onsets):
    core = webkit_core()
    node = shutil.which("node")
    if not core or not node:
        return R.skip("no playwright-core with an installed WebKit (set SCALITA_PLAYWRIGHT_CORE, or run "
                      "python3 -m playwright install webkit)" if node else "no node on PATH")
    pages = [x for x, c, _ in site.pages if c == "en"] + ["/404.html"]
    cfg = {"pages": pages, "piano": site.url("warm-up-piano"), "decode": decode_files(site),
           "decodeJs": DECODE_JS, "events": EVENTS, "fast": FAST, "routine": "routine:pre_performance", "voice": "tenor"}
    conf = scratch() / "webkit.json"
    conf.write_text(json.dumps(cfg), encoding="utf-8")
    run = subprocess.run([node, str(HERE / "webkit.mjs"), core, srv.origin, str(conf)], capture_output=True, text=True,
                         timeout=600)
    try:
        out = json.loads(run.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return R.check("webkit.mjs ran", False, (run.stdout + run.stderr)[-1500:])
    R.info("WebKit %s, through %s" % (out.get("version"), core))
    for path, r in out["pages"].items():
        R.check("%s: tools mounted, nothing missing, no console error, no audio before a tap, fits 360 px" % path,
                all(r["mounts"]) and not r["logs"] and not r["audio"] and r["over"] <= 0, r)
    judge_decode("webkit", out["decode"], site, onsets, 0.06, 30.0)
    pl = out.get("player")
    if pl:
        rid = cfg["routine"].split(":", 1)[1]
        want = [[i, r] for i, roots in enumerate(next(x for x in data("routines.json") if x["id"] == rid)["presets"]["tenor"]["roots"])
                for r in roots]
        R.check("the warm-up piano plays %s for tenor, the export's roots in order" % rid,
                pl.get("keys") == want and pl.get("ended"), {"got": (pl.get("keys") or [])[:10], "n": len(pl.get("keys") or []),
                                                                 "want": len(want), "error": pl.get("error")})
        before, after = pl.get("audioBefore"), pl.get("audioAfter") or []
        R.check("the warm-up piano: nothing under /audio/ before Play, piano samples after",
                before == [] and after and all(a.startswith("/audio/piano-web/") for a in after), [before, after[:4]])
        R.check("the warm-up piano: console clean", not pl["logs"], pl["logs"])


# ---------------------------------------------------------------------------


UNIT = ["parity", "piano", "scheduler", "player", "range-test", "sing-in-tune"]
PER_TOOL = ["range-test/e2e.py", "sing-in-tune/e2e.py", "player/smoke.py", "piano/smoke_test.py", "piano/samples_test.py",
            "parity/fakemic.py"]


def run_unit_suites():
    R.group = "unit"
    files = sorted(str(f) for d in UNIT for f in (REPO / "tool" / "tests" / d).glob("*.test.mjs"))
    r = subprocess.run(["node", "--test"] + files, cwd=str(REPO), capture_output=True, text=True)
    R.check("node --test, %d files" % len(files), r.returncode == 0, r.stdout[-1500:])
    for script in PER_TOOL:
        r = subprocess.run([sys.executable, "-B", str(REPO / "tool" / "tests" / script)], cwd=str(REPO),
                           capture_output=True, text=True)
        R.check(script, r.returncode == 0, (r.stdout + r.stderr)[-1500:])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", default=str(REPO), help="the built site (default: the repo root)")
    ap.add_argument("--only", default="", help="comma-separated groups: " + ", ".join(GROUPS))
    ap.add_argument("--locales", default="", help="comma-separated locales for the page sweep (default: every built one)")
    ap.add_argument("--all", action="store_true", help="also run the node unit tests and the per-tool browser tests")
    a = ap.parse_args()
    only = [g for g in a.only.split(",") if g] or list(GROUPS)
    unknown = sorted(set(only) - set(GROUPS))
    if unknown:
        ap.error("unknown group %s" % ", ".join(unknown))
    site = Site(a.site)
    codes = [c for c in a.locales.split(",") if c] or site.locales()
    if a.all:
        run_unit_suites()
    from playwright.sync_api import sync_playwright

    srv = Server(site.root)
    urls = set()
    onsets = ffmpeg_onsets(site) if {"decode", "firefox", "webkit"} & set(only) else None
    started = time.time()

    def run(steps):
        for g in GROUPS:
            if g in steps and g in only:
                R.group = g
                try:
                    steps[g]()
                except Exception as e:  # one broken group does not hide the others
                    R.check("ran to the end", False, "%s: %s" % (type(e).__name__, str(e)[:1200]))

    try:
        if set(only) - {"firefox", "webkit"}:
            with sync_playwright() as p:
                run({
                    "pages": lambda: group_pages(p, srv, site, codes, urls),
                    "links": lambda: group_links(srv, urls) if urls else R.skip("needs the pages group"),
                    "notfound": lambda: group_notfound(p, srv, site),
                    "langbar": lambda: group_langbar(p, srv, site),
                    "decode": lambda: group_decode(p, srv, site, onsets),
                    "range": lambda: group_range(p, srv, site),
                    "tune": lambda: group_tune(p, srv, site),
                    "player": lambda: group_player(p, srv, site),
                    "finder": lambda: group_finder(p, srv, site),
                    "locales": lambda: group_locales(p, srv, site),
                })
        # Neither needs Playwright for Python
        run({"firefox": lambda: group_firefox(srv, site, onsets), "webkit": lambda: group_webkit(srv, site, onsets)})
    finally:
        srv.close()
    print("%s: %d passed, %d failed, %d skipped, %.0f s" % (
        "PASS" if not R.failed else "FAIL", R.passed, R.failed, len(R.skipped), time.time() - started))
    for s in R.skipped:
        print("  skipped " + s)
    return 1 if R.failed else 0


if __name__ == "__main__":
    sys.exit(main())
