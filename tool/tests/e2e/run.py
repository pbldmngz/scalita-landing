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

  pages     every page in the sitemaps (and 404.html) on a 360 px phone, English
            also at 1280: no console error or warning, no failed request,
            nothing wider than the screen, every tool mount filled with no
            stray value, the page data contract, every Play link tagged with
            the page's locale and id and the iPhone "Coming soon" beside it,
            the band's buttons each on one line,
            the navigation of the page's context, no piano key with a border,
            no audio before a tap, no layout shift, and the budgets: scripts
            before a tap 15 KB gzipped, a tool page's HTML too (the hub's 18),
            its stylesheets 20 together
  links     every local URL those pages name answers 200, without a redirect
  notfound  404.html is noindex and its links resolve; a missing deep URL
            gets it with its styles and scripts
  langbar   a browser that prefers another language the page exists in gets
            the bar in that language; closed, it stays closed
  chrome    a phone's landing menu, full screen on every desktop tool page,
            the tools header on one row from 960 to 1920 px in every locale,
            the web app manifests, no service worker
  decode    every audio/piano-web/*.mp3 in the manifest, and only those,
            decodes gaplessly in Chromium with its attack where ffmpeg has it
  range     the vocal range test locks G2 and G4 from two takes through the
            fake microphone, processing off, no request while listening, no
            layout shift and nothing under the stage pushed down (at 360, 768
            and 900 px), the result and the tagged Play link, the 1080 x 1920
            image; three octaves on the keyboard name no voice type; an in-app
            browser's panel
  tune      sing this note with a steady A4: near 0 cents, five of five,
            the piano and the microphone never at once, no request while live,
            no layout shift and nothing under the stage pushed down (at 360,
            768 and 900 px), the 1080 x 1920 image
  player    Pre-Performance Quick for the tenor preset on the quick warm-up page,
            and the five-note scale for soprano on the warm-up piano, play
            the export's roots in order; audio only after Play
  finder    the voice break finder by its buttons, its result kept, and the
            warm-up piano built around it
  locales   every tool in every other built locale, to its result without a
            microphone (the keyboard, the listening check, the finder, the
            piano): nothing stray on it, nothing wider than 360 px, no key
            with a border
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
HUB_BUDGET = 18 * 1024  # the tools hub's HTML, which carries eight preview drawings (the spec, section 6)
CSS_BUDGET = 20 * 1024  # every stylesheet a page links, together
CLS_BUDGET = 0.01  # layout shift while a page loads: decision 11 asks for none, this leaves rounding
THEME = "#1E2628"
# Each file's own budget, gzipped KB (docs/specs/site-redesign-spec.md, section 6)
FILE_BUDGETS = {"css/style.css": 11, "css/chrome.css": 4, "css/home.css": 4, "css/hub.css": 2, "css/tool.css": 2,
                "css/tool-range.css": 1.5, "css/tool-tune.css": 1.5, "css/tool-player.css": 1.5, "css/guides.css": 2,
                "js/site/chrome.js": 2}
GROUPS = ("pages", "links", "notfound", "langbar", "chrome", "decode", "range", "tune", "player", "finder", "locales",
          "firefox", "webkit")
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
            extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                              ".webmanifest": "application/manifest+json"}  # as Pages serves it

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
        self._content = {}

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

    def content(self, code):
        """tool/content/<code>.json: the words the chrome prints."""
        if code not in self._content:
            self._content[code] = json.loads((REPO / "tool" / "content" / ("%s.json" % code)).read_text(encoding="utf-8"))
        return self._content[code]

    def tools(self):
        """The four tools in registry order: the tools section without its root."""
        return [e["id"] for e in self.registry if e["section"] == "tools" and not e.get("root")]

    def context(self, page_id):
        """tools (the hub and the four tools) or landing (everything else, the 404 included)."""
        return (self.by_id.get(page_id) or {}).get("context") or "landing"


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

    def __init__(self, browser, width=360, ua=None, locale=None, init=(), mobile=False):
        opts = {"viewport": {"width": width, "height": 800}}
        if mobile:  # a phone's touch screen: pointer coarse, hover none
            opts.update(has_touch=True, is_mobile=True)
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

# Layout shift from the first byte, as the page reports it (an input's own shifts left out)
CLS = """(() => {
  window.__cls = { value: 0, sources: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls.value += e.value;
        for (const s of e.sources || []) if (s.node && s.node.nodeType === 1 && window.__cls.sources.length < 6)
          window.__cls.sources.push(s.node.tagName.toLowerCase() + '.' + String(s.node.className).split(' ').join('.')
            + ' ' + e.value.toFixed(4));
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
})();"""

# Where the page under the stage sits, every frame from the test's mark on. A
# run taller than the room its stage reserves pushes it down, and the layout
# shift API forgives a push that lands in the half second after the tap on Start
STILL = """(() => {
  const P = window.__still = { lo: null, hi: null };
  const look = () => {
    const u = document.querySelector('.stage + *');
    if (!u) return;
    const y = u.getBoundingClientRect().top + scrollY;
    P.lo = P.lo === null ? y : Math.min(P.lo, y);
    P.hi = P.hi === null ? y : Math.max(P.hi, y);
  };
  P.mark = () => { P.lo = P.hi = null; look(); };
  const frame = () => { look(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
})();"""
TABLETS = (768, 900)  # a run must hold still on a tablet too, not only on the phone's 360

# The chrome a page shows: the header, its navigation, the tab bar, the footer
NAV_JS = """() => {
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const q = (s) => document.querySelector(s);
  const links = (s) => [...document.querySelectorAll(s)].map((a) => ({ href: a.getAttribute('href'),
    current: a.getAttribute('aria-current'), text: a.textContent.trim(), shown: shown(a) }));
  const bar = q('nav.site-tabbar');
  const box = bar && bar.getBoundingClientRect();
  const get = q('header .site-getapp');
  const href = get && get.getAttribute('href');
  const target = href && href.startsWith('#') ? document.getElementById(href.slice(1)) : null;
  return {
    header: (q('body > header.site-header') || {}).className || null,
    switcher: links('header nav.site-switch a'), switcherShown: shown(q('header nav.site-switch')),
    tabs: links('nav.site-tabbar a.site-tab'), tabsShown: shown(bar),
    tabsCut: [...document.querySelectorAll('nav.site-tabbar a.site-tab span')].filter((x) => shown(x)
      && x.scrollWidth > x.clientWidth).map((x) => x.textContent.trim()),
    tabBox: box ? [box.left, box.top, box.right, box.bottom, innerWidth, innerHeight] : null,
    siteNav: !!q('header nav.site-nav'), rows: links('#nav-menu a.site-menu__row'),
    menuGetApp: !!q('#nav-menu .site-menu__cta a'), toggle: shown(q('.site-menu__toggle[aria-controls="nav-menu"]')),
    lang: shown(q('header .lang-menu')), getApp: href, getAppShown: shown(get),
    getAppPlay: target ? !!target.querySelector('a[href^="https://play.google.com/"]') : null,
    footer: (q('footer.site-footer') || {}).className || null,
    footerText: ((q('footer.site-footer') || {}).textContent || '').replace(/\\s+/g, ' '),
    manifest: (q('link[rel="manifest"]') || {}).href || null,
    theme: (q('meta[name="theme-color"]') || {}).content || null,
    fs: shown(q('.tp-fs')), fsExit: !!q('.site-fs-exit'),
    // decision 3, the first screen: the tool in it, the reference below it, How it works shut
    stage: (q('.stage') || q('.hub-tiles') || { getBoundingClientRect: () => ({ top: null }) }).getBoundingClientRect().top,
    ref: (q('.tp-ref') || { getBoundingClientRect: () => ({ top: null }) }).getBoundingClientRect().top,
    how: (q('.tp-under details') || {}).open, vh: innerHeight,
  };
}"""

# Decision 8: beside every Google Play link that shows, the iPhone, visibly
# unavailable (no link, no working button) and saying it is coming soon
PLAY_JS = """([root, soon]) => [...document.querySelectorAll(root + ' a[href^="https://play.google.com/"]')]
  .filter((a) => a.getClientRects().length).map((a) => {
    const i = a.parentElement.querySelector('.btn--iphone');
    const ok = i && i.tagName !== 'A' && (i.tagName !== 'BUTTON' || i.disabled) && i.getClientRects().length
      && getComputedStyle(i).visibility !== 'hidden' && i.textContent.includes(soon);
    return ok ? null : (a.closest('[id]') || { id: 'page' }).id + ': ' + a.textContent.trim().slice(0, 50)
      + (i ? ' (' + i.outerHTML.slice(0, 120) + ')' : ' (no iPhone beside it)');
  }).filter(Boolean)"""

# The band's buttons keep their words on one line (each label measured as it
# wraps and unwrapped, in the same frame, so nothing paints in between)
BAND_JS = """() => [...document.querySelectorAll('.band__actions .btn')].filter((b) => b.getClientRects().length).map((b) => {
  const s = b.querySelector('span');
  if (!s) return null;
  const h = s.getBoundingClientRect().height, old = s.getAttribute('style');
  s.style.whiteSpace = 'nowrap';
  const one = s.getBoundingClientRect().height;
  old === null ? s.removeAttribute('style') : s.setAttribute('style', old);
  return h > one * 1.5 ? '"' + s.textContent.trim() + '" takes ' + Math.round(h / one) + ' lines' : null;
}).filter(Boolean)"""

# Decision 5: no piano key has a border or an outline; a gap parts the keys,
# the ends round to about a quarter of a key's width (6 px at most on a white
# key, 4 on a black one), a lit key glows from its fill (no inset line)
KEYS_JS = """(root) => {
  const bad = [];
  const px = (v) => parseFloat(v) || 0;
  const name = (el) => (el.getAttribute('class') || el.tagName) + (el.dataset && el.dataset.midi ? '[' + el.dataset.midi + ']' : '');
  const keys = [...document.querySelectorAll(root + ' :is(.key, .vb-step)')];
  for (const k of keys) {
    const s = getComputedStyle(k), r = k.getBoundingClientRect();
    if (!r.width) continue;
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((d) => s['border' + d + 'Style'] !== 'none' && px(s['border' + d + 'Width']) > 0);
    if (sides.length) bad.push(name(k) + ' has a border (' + sides.join(', ') + ')');
    if (s.outlineStyle !== 'none' && px(s.outlineWidth) > 0) bad.push(name(k) + ' has an outline');
    if (/inset/.test(s.boxShadow)) bad.push(name(k) + ' has an inset shadow: ' + s.boxShadow);
    const black = k.classList.contains('key--black');
    const cap = Math.min(black ? 4 : 6, r.width / 4) + 0.5;
    for (const c of ['borderBottomLeftRadius', 'borderBottomRightRadius'])
      if (px(s[c]) > cap) bad.push(name(k) + ' ' + c + ' ' + s[c] + ' on a ' + r.width.toFixed(1) + ' px key');
    if (bad.length > 6) break;
  }
  // the tools hub's drawings: filled shapes, never a stroke
  for (const k of document.querySelectorAll(root + ' :is(.hub-pv__key path, .hub-pv__key--b path, .hub-pv__key--on, .hub-pv__step)')) {
    const s = getComputedStyle(k);
    if (s.stroke !== 'none' && px(s.strokeWidth) > 0) bad.push('a drawn key (' + name(k) + ') has a stroke ' + s.stroke);
    if (bad.length > 6) break;
  }
  return { n: keys.length, bad };
}"""


def contract(site, pd, html, code, pid, mounts):
    """The page data contract (tool/README.md) for one page: its problems."""
    bad = []
    keys = {"locale", "lang", "pageId", "strings", "notes", "voiceTypes", "registers", "playLink",
            "androidOnlyLine", "iphone", "piano", "links", "assets", "players"}
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
    cta = site.content(code)["cta"]
    if pd.get("iphone") != "%s \u00b7 %s" % (cta["iphone"], cta["comingSoon"]):
        bad.append("iphone is %r, not the band's words" % pd.get("iphone"))
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


def nav_problems(site, nav, code, pid, width):
    """The navigation of a page's context (decision 2), and Get the app: what is
    wrong. Landing pages keep the site's menu (Features, Pricing, Download,
    Tools, Guides, Support, the language menu, Get the app; a menu on a
    phone); the tools hub and the tools show Home and the four tools, as a
    switcher on a desktop and as five floating tabs on a phone."""
    words = site.content(code)["nav"]
    home = site.url("index", code) or "/"
    tools = site.tools()
    want = [home] + [site.url(t, code) for t in tools]
    here = [site.url(pid, code)] if pid in tools else []
    phone = width < 960
    bad = []
    if site.context(pid) == "tools":
        if "site-header--tools" not in (nav["header"] or ""):
            bad.append("no tools header: %s" % nav["header"])
        got = [x["href"] for x in nav["switcher"]]
        if got != want:
            bad.append("the switcher links %s, not Home and the four tools %s" % (got, want))
        lit = [x["href"] for x in nav["switcher"] if x["current"] == "page"]
        if lit != here:
            bad.append("the switcher marks %s as this page" % lit)
        tabs = [[x["href"], x["text"]] for x in nav["tabs"]]
        labels = [words["home"]] + [words["tabLabels"][t] for t in tools]
        if tabs != [list(x) for x in zip(want, labels)]:
            bad.append("the tab bar is %s, not the five tabs %s" % (tabs, list(zip(want, labels))))
        if [x["href"] for x in nav["tabs"] if x["current"] == "page"] != here:
            bad.append("the tab bar marks another page")
        if nav["siteNav"] or nav["rows"] or nav["toggle"]:
            bad.append("a tools page carries the landing menu")
        if phone:
            if not nav["tabsShown"] or nav["switcherShown"] or nav["getAppShown"]:
                bad.append("on a phone: the tab bar %s, the switcher %s, Get the app %s in the header" % (
                    nav["tabsShown"], nav["switcherShown"], nav["getAppShown"]))
            if nav["tabsCut"]:
                bad.append("the tab bar cuts %s" % nav["tabsCut"])
            box = nav["tabBox"] or [0, 0, 0, 0, 1, 1]
            if box[0] < 0 or box[2] > box[4] or box[3] > box[5] or box[1] < box[5] / 2:
                bad.append("the tab bar does not float at the bottom of the screen: %s" % box)
        elif not nav["switcherShown"] or nav["tabsShown"] or not nav["getAppShown"]:
            bad.append("on a desktop: the switcher %s, the tab bar %s, Get the app %s" % (
                nav["switcherShown"], nav["tabsShown"], nav["getAppShown"]))
        if "site-footer--compact" not in (nav["footer"] or ""):
            bad.append("no compact footer: %s" % nav["footer"])
        man = "/site.webmanifest" if code == "en" else "/%s/site.webmanifest" % code
        if not (nav["manifest"] or "").endswith(man):
            bad.append("the web app manifest is %s, not %s" % (nav["manifest"], man))
        if nav["fsExit"] != (pid in tools) or nav["fs"] != (pid in tools and not phone):
            bad.append("the full screen control: %s, its exit %s" % (nav["fs"], nav["fsExit"]))
        if nav["stage"] is None or nav["stage"] > nav["vh"] * 0.4:
            bad.append("the tool starts at %s px on a %d px screen, not on its first part" % (nav["stage"], nav["vh"]))
        if pid in tools and (nav["ref"] is None or nav["ref"] < nav["vh"] or nav["how"] is not False):
            bad.append("the first screen holds the reference (at %s px) or an open How it works (%s)" % (nav["ref"], nav["how"]))
    else:
        if nav["header"] != "site-header":
            bad.append("no landing header: %s" % nav["header"])
        anchor = (lambda a: "#" + a) if pid == "index" else (lambda a: home + "#" + a)
        rows = [anchor("features"), anchor("pricing"), anchor("download"), site.url("tools", code),
                site.url("vocal-warm-ups", code), site.url("support", code)]
        got = [x["href"] for x in nav["rows"]]
        if got != rows:
            bad.append("the menu links %s, not today's %s" % (got, rows))
        if not nav["menuGetApp"]:
            bad.append("the phone menu has no Get the app")
        if nav["switcher"] or nav["tabs"]:
            bad.append("a landing page carries the tools navigation")
        shown = [x["shown"] for x in nav["rows"]]
        if phone and (not nav["toggle"] or any(shown)):
            bad.append("on a phone the menu is %s, its toggle %s" % (shown, nav["toggle"]))
        if not phone and (nav["toggle"] or not all(shown) or not nav["getAppShown"]):
            bad.append("on a desktop the menu is %s, its toggle %s, Get the app %s" % (shown, nav["toggle"], nav["getAppShown"]))
        footer = "site-footer site-footer--compact" if pid == "404" else "site-footer"
        if nav["footer"] != footer:
            bad.append("the footer is %s, not %s" % (nav["footer"], footer))
        if nav["manifest"] or nav["fs"] or nav["fsExit"]:
            bad.append("a landing page links the manifest or has full screen")
    if not nav["lang"]:
        bad.append("no language menu in the header")
    joke = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", site.content(code)["footer"]["madeBy"])).strip()
    if joke not in nav["footerText"]:
        bad.append("the footer lost its line %r" % joke)
    if (nav["theme"] or "").upper() != THEME:
        bad.append("theme-color %s" % nav["theme"])
    get = nav["getApp"] or ""
    if not (nav["getAppPlay"] if get.startswith("#") else get == home + "#download"):
        bad.append("Get the app goes to %s, which holds no Play link" % get)
    return bad


def css_size(site, html):
    """Every stylesheet a page links, gzipped one by one, together."""
    return sum(gz(site.file(h).read_bytes()) for h in re.findall(r'<link rel="stylesheet" href="(/[^"?]+)', html))


def group_pages(p, srv, site, codes, urls):
    tools = {e["id"] for e in site.registry if e["template"] == "tool"}
    browser = chromium(p)
    try:
        todo = [(path, c, i) for path, c, i in site.pages if c in codes] + [("/404.html", "en", "404")]
        for path, code, pid in todo:
            soon = site.content(code)["cta"]["comingSoon"]
            for width in ((360, 1280) if code == "en" else (360,)):
                t = Tab(browser, width, init=[CLS], mobile=width < 600)
                t0 = now()
                t.page.goto(srv.origin + path, wait_until="load")
                t.page.wait_for_timeout(400)
                shift = t.page.evaluate("window.__cls")
                nav = t.page.evaluate(NAV_JS)
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
                badges = [u for u in info["urls"] if u and re.search(r"apple\.com|app-?store|badge", u, re.I)]
                if badges:  # decision 8: no store badge and no Apple anything, the iPhone is "Coming soon"
                    bad.append("a store badge or an Apple link: %s" % badges)
                bad += nav_problems(site, nav, code, pid, width)
                bad += ["no iPhone beside a Play link: %s" % x for x in t.page.evaluate(PLAY_JS, ["", soon])]
                bad += ["the band's button %s" % x for x in t.page.evaluate(BAND_JS)]
                keys = t.page.evaluate(KEYS_JS, "")
                bad += keys["bad"]
                if shift["value"] > CLS_BUDGET:
                    bad.append("layout shift %.4f while it loads: %s" % (shift["value"], shift["sources"]))
                js = sum(gz(r.body()) for r in t.scripts)
                if js > BUDGET:
                    bad.append("scripts before a tap are %d bytes gzipped at %d px, over %d" % (js, width, BUDGET))
                extra = " (scripts %.1f KB" % (js / 1024)
                if width == 360:
                    urls.update((u, path) for u in info["urls"])
                    html = site.html(path)
                    size, css = gz(html.encode("utf-8")), css_size(site, html)
                    extra += ", HTML %.1f KB, CSS %.1f KB gzipped" % (size / 1024, css / 1024)
                    ceiling = HUB_BUDGET if pid == "tools" else BUDGET
                    if (pid in tools or pid == "tools") and size > ceiling:
                        bad.append("a tools page's HTML is %d bytes gzipped, over %d" % (size, ceiling))
                    elif size > BUDGET:
                        R.info("%s HTML is %.1f KB gzipped (the 15 KB budget is a tool page's)" % (path, size / 1024))
                    if css > CSS_BUDGET:
                        bad.append("its stylesheets are %d bytes gzipped together, over %d" % (css, CSS_BUDGET))
                    if pid in tools:  # the reference a crawler reads, in the HTML itself (decision 11)
                        ref = re.search(r'<section class="tp-ref".*?</section>\s*</main>', html, re.S)
                        words = len(re.sub(r"<[^>]+>", " ", ref.group(0)).split()) if ref else 0
                        if words < 300:
                            bad.append("the static reference holds %d words" % words)
                    pd = site.page_data(path)
                    if info["mounts"] and pd is None:
                        bad.append("tool mounts but no page data")
                    elif pd is not None:
                        bad += contract(site, pd, html, code, pid, info["mounts"])
                extra += ")" + (", %d keys" % keys["n"] if keys["n"] else "")
                R.check("%s at %d px%s" % (path, width, extra), not bad, bad)
                t.close()
        # Each stylesheet, and the script every page loads, within its own budget
        sizes = {n: gz((site.root / n).read_bytes()) for n in FILE_BUDGETS if (site.root / n).is_file()}
        new = sorted(str(f.relative_to(site.root)) for f in (site.root / "css").glob("*.css")
                     if str(f.relative_to(site.root)) not in FILE_BUDGETS)
        R.check("every stylesheet and js/site/chrome.js within its own budget (%s)" % ", ".join(
            "%s %.1f" % (n.split("/")[-1], v / 1024) for n, v in sizes.items()),
            not new and all(v <= FILE_BUDGETS[n] * 1024 for n, v in sizes.items()),
            {"over": {n: v for n, v in sizes.items() if v > FILE_BUDGETS[n] * 1024}, "no budget": new})
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
    said = re.search(r'<script type="application/json" id="site-langs">(.*?)</script>', site.html("/"))  # what the bar offers
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
            if n:
                box = t.page.evaluate("() => [document.querySelector('.lang-bar').getBoundingClientRect().bottom,"
                                      " document.querySelector('.site-tabbar').getBoundingClientRect().top]")
                R.check("in the tools a phone's bar sits above the tab bar", box[0] <= box[1] + 1, box)
            t.close()
    finally:
        browser.close()


# Full screen as a page shows it (spec 3.5): what still shows that should not
FS_JS = """() => {
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const away = ['.breadcrumb', '.tp-title', '.tp-under', '.tp-ref', '.band', '.site-footer', '.site-header__right'];
  let stored = null;
  try { stored = sessionStorage.getItem('scalita-fs'); } catch (e) {}
  return { on: document.documentElement.getAttribute('data-fs'),
    still: away.filter((s) => [...document.querySelectorAll(s)].some(shown)),
    tool: shown(document.querySelector('.stage [data-tool]')), switcher: shown(document.querySelector('header nav.site-switch')),
    exit: shown(document.querySelector('.site-fs-exit')), button: shown(document.querySelector('.tp-fs')),
    focus: document.activeElement ? String(document.activeElement.className) : null, stored };
}"""


# The tools header at a desktop width: one row (the logo, the switcher and the
# buttons, or Exit in full screen, side by side), nothing scrolled out of the
# switcher or out of the bar, and each tool's names: the full one as the
# link's aria-label and title, the one it shows
HEADER_JS = """() => {
  const hd = document.querySelector('header.site-header--tools'), h = hd.querySelector('.site-header__in');
  const fs = document.documentElement.getAttribute('data-fs') === 'on';
  const sw = h.querySelector('nav.site-switch');
  const box = (el) => el.getBoundingClientRect();
  const parts = [h.querySelector('.site-logo'), sw, h.querySelector(fs ? '.site-fs-exit' : '.site-header__right')];
  const mids = parts.map((el) => box(el).top + box(el).height / 2);
  const bad = [];
  if (box(hd).height > (fs ? 57 : 66)) bad.push('the bar is ' + box(hd).height.toFixed(1) + ' px tall');
  if (Math.max(...mids) - Math.min(...mids) > 3) bad.push('not one row: the middles at ' + mids.map(Math.round).join(', '));
  if (sw.scrollWidth > sw.clientWidth + 1) bad.push('the switcher hides ' + (sw.scrollWidth - sw.clientWidth) + ' px');
  const inner = box(h), s = box(sw);
  for (const el of parts) if (box(el).left < inner.left - 0.5 || box(el).right > inner.right + 0.5)
    bad.push(String(el.className) + ' leaves the bar');
  const segs = [...sw.querySelectorAll('a.seg')];
  for (const a of segs) if (box(a).left < s.left - 0.5 || box(a).right > s.right + 0.5) bad.push('"' + a.textContent.trim() + '" is cut');
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth) bad.push('the page is ' + de.scrollWidth + ' px wide');
  const tools = segs.filter((a) => !a.classList.contains('seg--home'));
  return { bad, names: tools.map((a) => [a.getAttribute('aria-label'), a.getAttribute('title')]),
    shown: tools.map((a) => [...a.querySelectorAll('span')].filter((x) => x.getClientRects().length).map((x) => x.textContent).join('|')) };
}"""


def png_size(b):
    """(width, height) of a PNG's bytes, or None."""
    return struct.unpack(">II", b[16:24]) if b[:8] == b"\x89PNG\r\n\x1a\n" and len(b) > 24 else None


def group_chrome(p, srv, site):
    """The chrome as it behaves: a phone's menu on a landing page, full screen
    on a desktop tool page (decision 4), the web app manifests and no
    service worker."""
    tools = site.tools()
    words = site.content("en")["nav"]
    browser = chromium(p)
    try:
        # A phone's menu on the landing pages: closed, then the six rows and Get the app
        t = Tab(browser, 360, mobile=True)
        t.page.goto(srv.origin + "/")
        menu = """() => { const m = document.getElementById('nav-menu'), b = document.querySelector('.site-menu__toggle');
          return { open: m.classList.contains('site-menu--open'), expanded: b.getAttribute('aria-expanded'),
            label: b.getAttribute('aria-label'), focus: String(document.activeElement.className),
            rows: [...m.querySelectorAll('a.site-menu__row')].filter((a) => a.getClientRects().length).length,
            getApp: [...m.querySelectorAll('.site-menu__cta a')].filter((a) => a.getClientRects().length).length }; }"""
        shut = t.page.evaluate(menu)
        t.page.click(".site-menu__toggle")
        opened = t.page.evaluate(menu)
        R.check("a phone's landing menu opens from its toggle: the six rows and Get the app, the toggle now closes it",
                not shut["open"] and not shut["rows"] and opened["open"] and opened["expanded"] == "true"
                and opened["label"] == words["closeMenu"] and opened["rows"] == 6 and opened["getApp"] == 1, [shut, opened])
        over = t.page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        t.page.keyboard.press("Escape")
        closed = t.page.evaluate(menu)
        R.check("Escape closes it and gives the toggle its focus back, nothing too wide",
                not closed["open"] and closed["label"] == words["menuLabel"] and "site-menu__toggle" in closed["focus"]
                and over <= 0, [closed, over])
        t.page.click(".site-menu__toggle")
        t.page.click('#nav-menu a.site-menu__row[href="#pricing"]')
        R.check("a row closes the menu as it goes", not t.page.evaluate(menu)["open"])
        R.check("menu: console clean", not t.clean(), t.clean())
        t.close()

        # Full screen, on a desktop: only the tool and the switcher, Escape or Exit leaves
        for pid in tools:
            path = site.url(pid)
            t = Tab(browser, 1280)
            t0 = now()
            t.page.goto(srv.origin + path)
            t.page.wait_for_timeout(300)
            early = srv.since(t0, "/js/site/fullscreen.js")
            t.page.click(".tp-fs")
            t.page.wait_for_function("document.documentElement.getAttribute('data-fs') === 'on'", timeout=5000)
            t.page.wait_for_timeout(100)
            on = t.page.evaluate(FS_JS)
            R.check("%s: Full screen leaves the tool and the switcher, and Exit has the focus (its script loads on the "
                    "click, not before)" % path,
                    not early and on["on"] == "on" and not on["still"] and on["tool"] and on["switcher"] and on["exit"]
                    and "site-fs-exit" in on["focus"] and on["stored"] == "1", [early, on])
            t.page.keyboard.press("Escape")
            off = t.page.evaluate(FS_JS)
            R.check("%s: Escape brings the page back and the focus to Full screen" % path,
                    off["on"] is None and not off["exit"] and off["button"] and "tp-fs" in off["focus"] and off["stored"] is None,
                    off)
            if pid == tools[0]:
                t.page.click(".tp-fs")
                t.page.wait_for_function("document.documentElement.getAttribute('data-fs') === 'on'")
                t.page.reload()
                t.page.wait_for_selector(".site-fs-exit", state="visible", timeout=5000)
                kept = t.page.evaluate(FS_JS)
                t.page.click(".site-fs-exit")
                left = t.page.evaluate(FS_JS)
                R.check("full screen holds over a reload, and Exit leaves it", kept["on"] == "on" and not kept["still"]
                        and left["on"] is None and left["stored"] is None and bool(left["still"]), [kept, left])
                t.page.click(".tp-fs")
                t.page.wait_for_function("document.documentElement.getAttribute('data-fs') === 'on'")
                with t.page.expect_navigation():
                    t.page.click('header nav.site-switch a[href="%s"]' % site.url(tools[1]))
                moved = t.page.evaluate(FS_JS)
                with t.page.expect_navigation():
                    t.page.click("header nav.site-switch a.seg--home")
                home = t.page.evaluate("document.documentElement.getAttribute('data-fs')")
                t.page.goto(srv.origin + path)
                again = t.page.evaluate(FS_JS)
                R.check("the switcher keeps full screen from tool to tool; Home leaves it", moved["on"] == "on"
                        and not moved["still"] and home is None and again["on"] is None, [moved, home, again])
            R.check("%s: full screen, console clean" % path, not t.clean(), t.clean())
            t.close()

        # The tools header: one row at every desktop width in every locale, in
        # the page and in full screen, nothing cut; short names (the tab bar's)
        # where the full ones do not fit, the full ones at 1920
        for code in site.locales():
            path = site.url(tools[0], code)
            full = [json.loads((REPO / "tool" / "content" / "pages" / code / ("%s.json" % i)).read_text(
                encoding="utf-8"))["label"] for i in tools]
            short = [site.content(code)["nav"]["tabLabels"][i] for i in tools]
            bad, first = [], {}
            for width in (960, 1024, 1280, 1366, 1440, 1600, 1920):
                t = Tab(browser, width)
                t.page.goto(srv.origin + path)
                t.page.evaluate("document.fonts.ready")
                for mode in ("page", "full screen"):
                    if mode == "full screen":
                        t.page.click(".tp-fs")
                        t.page.wait_for_function("document.documentElement.getAttribute('data-fs') === 'on'", timeout=5000)
                    got = t.page.evaluate(HEADER_JS)
                    where = "%d px, %s: " % (width, mode)
                    bad += [where + x for x in got["bad"]]
                    # No aria-label: a link is named by the label it shows (the
                    # other is display: none), so what a speech-input user reads
                    # is what they can say (WCAG 2.5.3); its title keeps the full name
                    if got["names"] != [[None, n] for n in full]:
                        bad.append(where + "the links' [aria-label, title] are %s, not [None, full name] for %s" % (
                            got["names"], full))
                    if got["shown"] not in (full, short) or (width == 1920 and got["shown"] != full):
                        bad.append(where + "the switcher shows %s" % got["shown"])
                    if got["shown"] == full:
                        first.setdefault(mode, width)
                bad += t.clean()
                t.close()
            R.check("%s: the tools header is one row from 960 to 1920 px, in the page and in full screen, nothing cut "
                    "(the full names from %s px, %s in full screen)" % (path, first.get("page"), first.get("full screen")),
                    not bad, bad)

        # Phones never see the control, nor load its script
        t = Tab(browser, 360, mobile=True)
        t0 = now()
        t.page.goto(srv.origin + site.url(tools[0]))
        t.page.wait_for_timeout(300)
        R.check("a phone shows no Full screen and loads none of it", not t.page.evaluate(FS_JS)["button"]
                and not srv.since(t0, "/js/site/fullscreen.js"))
        t.close()

        # The web app manifests: Android Chrome adds the tools to a home screen, no service worker
        for code in site.locales():
            hub, root = site.url("tools", code), site.url("index", code)
            path = root + "site.webmanifest"
            bad = []
            try:
                man = json.loads(site.file(path).read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                R.check("%s parses" % path, False, str(e))
                continue
            want = {"name": "Scalita", "start_url": hub, "scope": root, "display": "standalone",
                    "background_color": THEME, "theme_color": THEME}
            bad += ["%s is %r, not %r" % (k, man.get(k), v) for k, v in want.items() if str(man.get(k)).upper() != str(v).upper()]
            pd = site.page_data(hub) or {}
            if man.get("lang") != pd.get("lang", man.get("lang")):
                bad.append("lang %r" % man.get("lang"))
            icons = man.get("icons") or []
            for i in icons + [x for s in man.get("shortcuts") or [] for x in s.get("icons") or []]:
                f = site.file(i.get("src", ""))
                size = png_size(f.read_bytes()) if f.is_file() else None
                if not size or "%dx%d" % size != i.get("sizes"):
                    bad.append("icon %s is %s, not %s" % (i.get("src"), size, i.get("sizes")))
            if not any(i.get("purpose") == "maskable" and i.get("sizes") == "512x512" for i in icons) or not any(
                    i.get("sizes") == "192x192" for i in icons):
                bad.append("no 192 icon or no maskable 512")
            for sc in man.get("shortcuts") or []:
                if sc.get("url") not in [site.url(t, code) for t in tools]:
                    bad.append("a shortcut to %s" % sc.get("url"))
            R.check("%s: Scalita, standalone, opens the tools hub %s, every icon there" % (path, hub), not bad, bad)
        t = Tab(browser, 390, mobile=True)
        t.page.goto(srv.origin + site.url(tools[0]))
        t.page.wait_for_timeout(800)
        cdp = t.ctx.new_cdp_session(t.page)
        man = cdp.send("Page.getAppManifest")
        errors = [e.get("errorId") for e in cdp.send("Page.getInstallabilityErrors").get("installabilityErrors", [])
                  if e.get("errorId") != "in-incognito"]  # every Playwright context is a private one
        workers = t.page.evaluate("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 0")
        R.check("Chromium finds the tools installable from their manifest, with no service worker",
                (man.get("url") or "").endswith("/site.webmanifest") and not man.get("errors") and not errors and workers == 0,
                {"manifest": man.get("url"), "errors": man.get("errors"), "installability": errors, "workers": workers})
        t.close()
        sw = [path for path, _, _ in site.pages if "serviceWorker" in site.html(path)]
        R.check("no page registers a service worker", not sw and not list(REPO.glob("js/**/sw*.js")), sw)
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
  // on Android the page's band carries the result's line and the one Play link
  const band = document.querySelector('#app');
  const a = el.querySelector('.result__cta a') || (band && band.querySelector('a[href^="https://play.google.com/"]'));
  const q = (s) => [...el.querySelectorAll(s)].map((x) => x.textContent);
  return { value: (el.querySelector('.result-card__value') || {}).textContent || '',
           cta: (el.querySelector('.result__cta p') || (band && band.querySelector('.band__body')) || {}).textContent || '',
           play: a ? a.getAttribute('href') : null, inStage: el.querySelectorAll('a[href^="https://play.google.com/"]').length,
           dt: q('.result-card__facts dt'), dd: q('.result-card__facts dd'), notes: q('.result__meaning li'),
           image: (el.querySelector('canvas') || { getAttribute: () => '' }).getAttribute('aria-label') || '' };
}"""


def save_png(t, name):
    """Save image, as the reader would: the downloaded file's (width, height) and name."""
    with t.page.expect_download(timeout=15000) as dl:
        t.page.get_by_role("button", name=name, exact=True).click(timeout=15000)  # waits for the drawing
    f = dl.value.path()
    return (png_size(Path(f).read_bytes()) if f else None), dl.value.suggested_filename


def range_wide(p, srv, site, path):
    """Decision 6: a range of three octaves or more names no voice type (the
    app's VoiceType.rangeNamesAType, 12 to 35 semitones); in its place, as
    Pablo's final range image has it (spec 4.2, 2026-10-26), the voice types
    it holds whole, on the result card and in the image alike. Chosen on the
    keyboard: C2 to C5, which holds bass, baritone and tenor."""
    pd = site.page_data(path)
    U, C = pd["strings"]["vocal-range-test"], pd["strings"]["common"]
    m = '[data-tool="vocal-range-test"]'
    browser = chromium(p)
    try:
        t = Tab(browser, 360, ua=ANDROID)
        t.page.goto(srv.origin + path)
        t.page.wait_for_selector(m + '[data-state="idle"]')
        t.page.get_by_role("button", name=U["noMic"], exact=True).click()
        t.page.get_by_role("button", name=U["lowerKeys"], exact=True).click()
        t.page.click(m + ' .tool-panel__state--manual .keyboard [data-midi="36"]')
        t.page.keyboard.press("ArrowRight")  # the arrows walk the keys: the focus shows
        focus = t.page.evaluate("""() => { const k = document.activeElement, s = getComputedStyle(k);
          return { key: k.classList.contains('key'), shows: k.matches(':focus-visible'), outline: [s.outlineStyle, s.outlineWidth],
            border: ['Top', 'Right', 'Bottom', 'Left'].map((d) => s['border' + d + 'Width']), shadow: s.boxShadow }; }""")
        R.check("a key with the keyboard's focus shows it with a glow, no outline and no border",
                focus["key"] and focus["shows"] and (focus["outline"][0] == "none" or focus["outline"][1] == "0px")
                and focus["border"] == ["0px"] * 4 and "inset" not in focus["shadow"] and focus["shadow"] != "none", focus)
        picker = t.page.evaluate(KEYS_JS, m)
        t.page.get_by_role("button", name=C["next"], exact=True).click()
        for _ in range(2):
            t.page.get_by_role("button", name=U["higherKeys"], exact=True).click()
        t.page.click(m + ' .tool-panel__state--manual .keyboard [data-midi="72"]')
        t.page.get_by_role("button", name=U["showRange"], exact=True).click()
        t.page.wait_for_selector(m + '[data-state="result"]')
        r = t.page.evaluate(RANGE_RESULT)
        names = {v["id"]: v["name"] for v in pd["voiceTypes"]}
        big, small = fill(U["typesMany"], n=3), fill(U["typesSpan"], low=names["bass"], high=names["tenor"])
        R.check("C2 to C5, three octaves: no single voice type, the three it holds whole (bass to tenor) on the card and "
                "in the image, and the wide-range note",
                U["typicalLabel"] not in r["dt"] and big in r["dt"] and small in r["dd"] and big in r["image"]
                and small in r["image"] and U["wideNote"] in r["notes"] and U["breakMoreReliable"] not in r["notes"],
                {"want": [big, small], "dt": r["dt"], "dd": r["dd"], "notes": r["notes"], "image": r["image"]})
        size, name = save_png(t, C["save"])
        R.check("the three-octave share image saves as a 1080 x 1920 PNG", size == (1080, 1920) and name.endswith(".png"),
                [size, name])
        keys = t.page.evaluate(KEYS_JS, m)
        R.check("no key of the picker or the result has a border, an outline or a hard end (%d and %d keys)"
                % (picker["n"], keys["n"]), picker["n"] and keys["n"] and not picker["bad"] + keys["bad"],
                picker["bad"] + keys["bad"])
        soon = t.page.evaluate(PLAY_JS, ["#app", site.content(pd["locale"])["cta"]["comingSoon"]])
        R.check("the keyboard's result: one Play link, the band's, with the iPhone, coming soon, beside it",
                not soon and r["inStage"] == 0 and r["play"] == pd["playLink"], [soon, r["inStage"], r["play"]])
        R.check("three octaves: console clean", not t.clean(), t.clean())
        t.close()
    finally:
        browser.close()


def still_at(p, srv, path, wav, width, init, idle, start, end):
    """One run at width px from a fresh browser (the fake microphone's file
    plays from its start): once the tool is idle and its fonts are in, mark
    where the page under the stage sits; start(t) taps Start, end(t) waits
    for the run to end. The layout shift since the load, how far the page
    under the stage moved since the mark (px), and the console."""
    browser = chromium(p, wav)
    try:
        t = Tab(browser, width, ua=ANDROID, init=list(init) + [CLS, STILL])
        t.page.goto(srv.origin + path)
        t.page.wait_for_selector(idle)
        t.page.evaluate("document.fonts.ready.then(() => window.__still.mark())")
        start(t)
        end(t)
        shift, still = t.page.evaluate("[window.__cls, window.__still]")
        out = shift, round(still["hi"] - still["lo"], 1), t.clean()
        t.close()
        return out
    finally:
        browser.close()


def group_range(p, srv, site):
    path = site.url("vocal-range-test")
    if not path:
        return R.skip("the vocal range test page is not built")
    range_wide(p, srv, site, path)
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
        t = Tab(browser, 360, ua=ANDROID, init=[EVENTS, PROBE % "{}", CLS, STILL])
        t0 = now()
        t.page.goto(srv.origin + path)
        t.page.wait_for_selector(mount + '[data-state="idle"]')
        t.page.evaluate("document.fonts.ready.then(() => window.__still.mark())")
        t.page.get_by_role("button", name=C["start"], exact=True).click()
        t.page.wait_for_function("window.__ev.some((e) => e.phase === 'done')", timeout=int((seconds + 30) * 1000))
        shift, still = t.page.evaluate("[window.__cls, window.__still]")
        moved = round(still["hi"] - still["lo"], 1)
        R.check("nothing on the screen moves while it listens, from the page's load to the second lock",
                shift["value"] <= CLS_BUDGET and moved <= 1, {"shift": shift, "moved px": moved})
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
        cta = t.page.locator('#app a[href^="https://play.google.com/"]')
        R.check("Android: the band takes the result's line, with the one tagged Play link, visible",
                r["cta"] == fill(U["ctaAndroid"], range=rng) and r["play"] == pd["playLink"] and r["inStage"] == 0
                and "utm_campaign%3Dvocal-range-test" in r["play"] and cta.is_visible(), r)
        over = t.page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        R.check("the result fits 360 px", over <= 0, over)
        R.check("two octaves name a voice type", U["typicalLabel"] in r["dt"], r["dt"])
        soon = t.page.evaluate(PLAY_JS, ["#app", site.content(pd["locale"])["cta"]["comingSoon"]])
        R.check("Android: the iPhone, coming soon, beside the band's Play link", not soon, soon)
        keys = t.page.evaluate(KEYS_JS, mount)
        R.check("the result's keys: no border, no outline (%d keys)" % keys["n"], keys["n"] and not keys["bad"], keys["bad"])
        size, name = save_png(t, C["save"])
        R.check("the share card saves as a 1080 x 1920 PNG", size == (1080, 1920) and name.endswith(".png"), [size, name])
        check_versioned(t, pd, srv, t0)
        R.check("console clean", not t.clean(), t.clean())
        t.close()

        for width in TABLETS:
            shift, moved, logs = still_at(
                p, srv, path, wav, width, [EVENTS], mount + '[data-state="idle"]',
                lambda t: t.page.get_by_role("button", name=C["start"], exact=True).click(),
                lambda t: t.page.wait_for_function("window.__ev.some((e) => e.phase === 'done')",
                                                   timeout=int((seconds + 30) * 1000)))
            R.check("at %d px too, nothing on the screen moves while it listens, from the page's load to the second lock"
                    % width, shift["value"] <= CLS_BUDGET and moved <= 1 and not logs,
                    {"shift": shift, "moved px": moved, "console": logs})

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
        idle = '[data-tool="sing-in-tune-test"][data-state="idle"] .tool-panel__actions .btn'
        start = '.tool-panel__state--idle:not([hidden]) button >> text="%s"' % C["start"]
        t = Tab(browser, 360, ua=ANDROID, init=[PROBE % json.dumps({"targets": targets, "seed": 7}), CLS, STILL])
        t0 = now()
        t.page.goto(srv.origin + path)
        t.page.wait_for_selector(idle)
        mode = t.page.get_attribute('.seg[aria-pressed="true"]', "data-mode")
        R.check("the page opens on sing this note", mode == "sing", mode)
        t.page.evaluate("document.fonts.ready.then(() => window.__still.mark())")
        t.page.click(start)
        t.page.wait_for_selector(".tool-panel__state--result:not([hidden])", timeout=120000)
        r = t.page.evaluate("""() => {
          const r = document.querySelector('.tool-panel__state--result:not([hidden])');
          // the page's band, under the stage, carries the one Play link
          const a = document.querySelector('#app a[href^="https://play.google.com/"]');
          return { value: r.querySelector('.result-card__value').textContent,
                   facts: Object.fromEntries([...r.querySelectorAll('.result-card__facts > div')].map((d) =>
                     [d.querySelector('dt').textContent, d.querySelector('dd').textContent])),
                   href: a ? a.getAttribute('href') : null,
                   inStage: r.querySelectorAll('a[href^="https://play.google.com/"]').length };
        }""")
        m = re.match(r"([+-]?\d+)", r["value"].replace("\u2212", "-"))  # a minus sign, or a hyphen
        R.check("a steady A4 sung back to A3 and A4 reads within 2 cents", m and abs(int(m.group(1))) <= 2, r["value"])
        five = fill(U["result"]["count"], n=5, total=5)
        R.check("five of five within 10 cents", r["facts"].get(U["result"]["within10"]) == five, r["facts"])
        shown = t.page.inner_text(".tool-panel__state--result:not([hidden])")
        R.check("the result prints no null (a perfect round has no line under the figure)",
                not re.search(r"\bnull\b", shown), shown[:200])
        shift, still = t.page.evaluate("[window.__cls, window.__still]")
        moved = round(still["hi"] - still["lo"], 1)
        R.check("nothing on the screen moves through the five notes and the result",
                shift["value"] <= CLS_BUDGET and moved <= 1, {"shift": shift, "moved px": moved})
        probe = t.page.evaluate(PROBED)
        R.check("the piano and the microphone never at once", not probe["violations"], probe["violations"])
        R.check("one microphone check, then one opening per note", probe["gum"] == len(targets) + 1, probe["gum"])
        live_checks(t, srv, probe["listening"], probe["spans"])
        R.check("the microphone is off at the end", not probe["live"])
        R.check("Android: one Play link, the band's, tagged", r["href"] == pd["playLink"] and r["inStage"] == 0
                and "utm_campaign%3Dsing-in-tune-test" in (r["href"] or ""), [r["href"], r["inStage"]])
        soon = t.page.evaluate(PLAY_JS, ["#app", site.content(pd["locale"])["cta"]["comingSoon"]])
        R.check("Android: the iPhone, coming soon, beside the band's Play link", not soon, soon)
        size, name = save_png(t, C["save"])
        R.check("the result's share image saves as a 1080 x 1920 PNG", size == (1080, 1920) and name.endswith(".png"),
                [size, name])
        check_versioned(t, pd, srv, t0)
        R.check("console clean", not t.clean(), t.clean())
        t.close()

        for width in TABLETS:
            # the result's share row settles once its image's module is in
            shift, moved, logs = still_at(
                p, srv, path, wav, width, [PROBE % json.dumps({"targets": targets, "seed": 7})], idle,
                lambda t: t.page.click(start),
                lambda t: (t.page.wait_for_selector(".tool-panel__state--result:not([hidden])", timeout=120000),
                           t.page.wait_for_timeout(1500)))
            R.check("at %d px too, nothing on the screen moves through the five notes and the result" % width,
                    shift["value"] <= CLS_BUDGET and moved <= 1 and not logs,
                    {"shift": shift, "moved px": moved, "console": logs})
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
            t.page.click('[data-tool="player"] .btn--fill')
            ev = play_until_end(t)
            keys = [[e["step"], e["root"]] for e in ev if e["type"] == "key"]
            want = [[i, r] for i, roots in enumerate(routines[rid]["presets"]["tenor"]["roots"]) for r in roots]
            R.check("quick warm-up page: %s for the tenor preset plays the export's roots in order" % rid, keys == want,
                    {"got": keys[:10], "want": want[:10], "n": [len(keys), len(want)]})
            audio = srv.since(t1, "/audio/")
            R.check("quick warm-up page: after Play, piano samples only", audio and all(
                a.startswith("/audio/piano-web/") and a.endswith(".mp3") for a in audio), audio)
            R.check("quick warm-up page: Play again at the end",
                    t.page.text_content('[data-tool="player"] .btn--fill') == pd["strings"]["common"]["play"])
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
        t.page.click('[data-tool="player"] .btn--fill')
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
        t.page.click(mount + " .btn--fill")
        t.page.wait_for_selector(mount + '[data-state="voice"]')
        t.page.get_by_role("button", name=U["lowerVoice"]).click()
        t.page.wait_for_function("window.__ev.filter((e) => e.type === 'note').length >= 5", timeout=30000)
        stairs = t.page.evaluate(KEYS_JS, mount)
        R.check("the climb's keys: no border, no outline (%d keys)" % stairs["n"], stairs["n"] and not stairs["bad"],
                stairs["bad"])
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
    t.page.wait_for_selector('[data-tool="sing-in-tune-test"][data-state="idle"] .tool-panel__actions .btn')
    t.page.click('.seg[data-mode="ear"]')
    t.page.click('.tool-panel__state--idle:not([hidden]) button >> text="%s"' % C["start"])
    for _ in range(3):
        t.page.get_by_role("button", name=U["ear"]["higher"], exact=True).click(timeout=15000)  # waits until enabled
        t.page.get_by_role("button", name=C["next"], exact=True).click(timeout=5000)
    t.page.wait_for_selector(".tool-panel__state--result:not([hidden])", timeout=15000)
    return m


def drive_finder(t, pd):
    U, m = pd["strings"]["voice-break-finder"], '[data-tool="voice-break-finder"]'
    t.page.wait_for_selector(m + '[data-state="intro"]')
    t.page.click(m + " .btn--fill")
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
    t.page.click(m + " .btn--fill")
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
                        + (["%d px too wide" % over] if over > 0 else []) + t.page.evaluate(KEYS_JS, m)["bad"]
                    R.check("%s: to its result, nothing stray, fits 360 px, no key with a border, console clean" % path,
                            not bad, bad)
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
            ff.wait("document.querySelector('.seg[data-mode=\"tuner\"]')")
            ff.click("//button[@data-mode='tuner']")
            ff.click("//div[contains(@class,'tool-panel__state--idle') and not(@hidden)]//button[normalize-space()=%s]"
                     % json.dumps(C["start"]))
            # 1 kHz is B5 and 21 cents
            name = ff.wait("(() => { const n = document.querySelector('.note-target__name');"
                           " return n && n.textContent.trim() === %s ? n.textContent : null; })()"
                           % json.dumps(pd["notes"]["83"][0]), timeout=20)
            time.sleep(2.0)
            readout = ff.js("const p = document.querySelector('.tool-panel__state--run:not([hidden]) .st-readout__main');"
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
            ff.click("//div[@data-tool='player']//button[contains(@class,'btn--fill')]")
            notes = ff.wait("window.__ev.filter((e) => e.type === 'note').length >= 4", timeout=30)
            first = ff.js("return window.__ev.filter((e) => e.type === 'key').map((e) => e.root)")
            ff.click("//div[@data-tool='player']//button[contains(@class,'btn--fill')]")
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


UNIT = ["parity", "piano", "scheduler", "player", "range-test", "sing-in-tune", "share"]
PER_TOOL = ["range-test/e2e.py", "sing-in-tune/e2e.py", "player/smoke.py", "piano/smoke_test.py", "piano/samples_test.py",
            "parity/fakemic.py", "share/e2e.py"]


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
                    "chrome": lambda: group_chrome(p, srv, site),
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
