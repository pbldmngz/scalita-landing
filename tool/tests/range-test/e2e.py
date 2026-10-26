"""The vocal range test in headless Chromium, fed through the fake microphone.

    python3 -B tool/tests/range-test/e2e.py

Serves the repo read-only on 127.0.0.1 (js/ css/ fonts/ audio/ images/, and
fixture.html at /tools/vocal-range-test/ filled with the page data that
`tool/build.py --page-data vocal-range-test` prints and the import map a built
page carries). Writes nothing into the repo: the composed WAVs go to
SCALITA_SCRATCH, else the temp folder. Needs Playwright for Python and its
Chromium; the two-takes run needs the app's takes (SCALITA_TAKES, else the
sibling scalita_app checkout) and is skipped without them.

  two takes  an Android phone: G2 then G4 locked from Pablo's takes, the
             result, the tagged Play link; the processing flags off; nothing
             fetched while the mic is live; the piano downloads only after its
             button, with the mic off, and lights the keys it plays
  tones      a computer: A3 and A5 from sine tones, with fry and whistle
             readings hinted, flagged and not counted; the computer's CTA
  in-app     an Instagram user agent gets the open-in-your-browser panel
  errors     each of mic.js's nine error codes shows its own string; a
             browser with no AudioWorklet shows micUnsupported before a tap
  keyboard   the no-mic path with the keyboard alone: a key plays the piano,
             a narrow range names no voice type, last time is remembered
  budget     before a tap: this module and mic.js only, under 15 KB gzipped,
             no audio, no share card
"""
import gzip
import http.server
import json
import math
import os
import re
import struct
import subprocess
import sys
import tempfile
import threading
import time
import wave
from pathlib import Path

sys.dont_write_bytecode = True  # everything in this repo is served: leave no __pycache__
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
FX = json.loads((HERE / "fixtures.json").read_text(encoding="utf-8"))
PAGE = "/tools/vocal-range-test/"
SERVED = ("/js/", "/css/", "/fonts/", "/audio/", "/images/")
KINDS = {".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg",
         ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml"}
ANDROID = ("Mozilla/5.0 (Linux; Android 14; SM-A725F) AppleWebKit/537.36 (KHTML, like Gecko) "
           "Chrome/151.0.0.0 Mobile Safari/537.36")
INSTAGRAM = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
             "Mobile/15E148 Instagram 330.0.0.21.111 (iPhone14,5; iOS 17_5; en_US; en)")
ERRORS = ["micUnsupported", "micInApp", "micBlocked", "micDismissed", "micNotFound", "micBusy",
          "micInterrupted", "micHidden", "micFailed"]

# Events, hints and layout shifts, recorded from the first byte of the page
INIT = """
window.__ev = []; window.__hints = []; window.__cls = 0;
addEventListener('rangetest', (e) => window.__ev.push(Object.assign({ at: performance.now() }, e.detail)), true);
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
}).observe({ type: 'layout-shift', buffered: true });
document.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(() => {
    for (const h of document.querySelectorAll('.tool-panel__hint')) {
      const t = h.textContent;
      if (t && !window.__hints.includes(t)) window.__hints.push(t);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
"""

RESULT = """() => {
  const el = document.querySelector('[data-tool] .tool-panel__state--result');
  const q = (s) => [...el.querySelectorAll(s)].map((x) => x.textContent);
  const a = el.querySelector('.result__cta a');
  return { value: q('.result-card__value')[0], dt: q('.result-card__facts dt'), dd: q('.result-card__facts dd'),
    notes: q('.result-card .result-card__note'), cta: q('.result__cta p')[0], play: a ? a.getAttribute('href') : null,
    copy: !!el.querySelector('.result__cta button'), keys: el.querySelectorAll('.keyboard .key--range').length };
}"""


def fill(s, **v):
    return re.sub(r"\{(\w+)\}", lambda m: str(v[m.group(1)]) if m.group(1) in v else m.group(0), s)


def typical_for(types, low, high):
    """VoiceType.closestForRange, as js/tools/vocal-range-test.js ports it."""
    mid = (low + high) / 2
    by = sorted(((abs((t["rangeLow"] + t["rangeHigh"]) / 2 - mid), i, t) for i, t in enumerate(types)),
                key=lambda x: (x[0], x[1]))
    return [by[0][2], by[1][2]] if len(by) > 1 and by[1][0] - by[0][0] <= 2 else [by[0][2]]


def takes_dir():
    d = os.environ.get("SCALITA_TAKES") or str((HERE / FX["takesDir"]).resolve())
    return d if os.path.isdir(d) else None


def scratch():
    d = Path(os.environ.get("SCALITA_SCRATCH") or Path(tempfile.gettempdir()) / "scalita-tests") / "range-test"
    d.mkdir(parents=True, exist_ok=True)
    return d


def compose(segments, path, rate=44100):
    """The fixture's segments as one 16-bit mono WAV, silence padded."""
    out = bytearray()
    for s in segments:
        if "silence" in s:
            out += b"\0\0" * round(s["silence"] * rate)
        elif "hz" in s:
            n, ramp = round(s["sec"] * rate), round(0.01 * rate)
            out += b"".join(struct.pack("<h", round(32767 * 0.3 * math.sin(2 * math.pi * s["hz"] * i / rate)
                                                     * min(1, i / ramp, (n - 1 - i) / ramp))) for i in range(n))
        else:
            with wave.open(str(Path(takes_dir()) / s["take"]), "rb") as w:
                assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (rate, 1, 2), s["take"]
                data = w.readframes(w.getnframes())
            a = round(s.get("from", 0) * rate) * 2
            b = len(data) if s.get("to") is None else round(s["to"] * rate) * 2
            out += data[a:b]
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(out))
    return len(out) / 2 / rate


def page_data(loc="en"):
    run = subprocess.run([sys.executable, "-B", str(REPO / "tool" / "build.py"), "--allow-missing",
                          "--page-data", "vocal-range-test", "--locale", loc],
                         capture_output=True, text=True, cwd=str(REPO), check=True)
    return json.loads(run.stdout)


def fixture(data):
    safe = lambda o: json.dumps(o, ensure_ascii=False).replace("<", "\\u003c")
    assets = data.get("assets") or {}
    return ((HERE / "fixture.html").read_text(encoding="utf-8")
            .replace("__LANG__", data.get("lang", "en"))
            .replace("__PAGE_DATA__", safe(data))
            .replace("__IMPORT_MAP__", safe({"imports": assets}))
            .replace("__MODULE__", assets.get("/js/tools/vocal-range-test.js", "/js/tools/vocal-range-test.js")))


class Handler(http.server.BaseHTTPRequestHandler):
    page = b""
    log = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        Handler.log.append((time.monotonic(), path))
        if path == PAGE:
            return self.reply(self.page, "text/html; charset=utf-8")
        if path.startswith(SERVED) and ".." not in path:
            f = REPO / path.lstrip("/")
            if f.is_file():
                return self.reply(f.read_bytes(), KINDS.get(f.suffix, "application/octet-stream"))
        if path == "/favicon.ico":
            self.send_response(204)
            return self.end_headers()
        self.send_error(404)

    def reply(self, body, kind):
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def fetched(since, prefix):
    return [p for t, p in Handler.log if t >= since and p.startswith(prefix)]


class Run:
    def __init__(self, p, origin, data):
        self.p, self.origin, self.data = p, origin, data
        s = data["strings"]
        self.U, self.C, self.M = s["vocal-range-test"], s["common"], s["mic"]
        self.checks = []

    def check(self, name, ok, got=None):
        self.checks.append((name, bool(ok), got))

    def launch(self, wav=None):
        args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                "--autoplay-policy=no-user-gesture-required"]
        if wav:
            args.append("--use-file-for-fake-audio-capture=%s%%noloop" % wav)
        try:
            return self.p.chromium.launch(channel="chromium", headless=True, args=args)
        except Exception:
            return self.p.chromium.launch(headless=True, args=args)

    def open(self, browser, ua=None, init=None):
        opts = {"viewport": {"width": 390, "height": 844}}
        if ua:
            opts["user_agent"] = ua
        ctx = browser.new_context(**opts)
        page = ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append("%s: %s" % (m.type, m.text)) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: logs.append("pageerror: %s" % e))
        page.add_init_script(INIT)
        if init:
            page.add_init_script(init)
        page.goto(self.origin + PAGE)
        page.wait_for_selector('[data-tool="vocal-range-test"][data-state]')
        return ctx, page, logs

    def clean(self, label, page):
        """No false, null, undefined, NaN or unfilled {placeholder} on screen."""
        text = page.locator('[data-tool="vocal-range-test"]').inner_text()
        bad = re.findall(r"\b(?:false|true|null|undefined|NaN)\b|\{\w+\}", text)
        self.check(label + ": no stray values on screen", not bad, bad)

    def name(self, m):
        local, intl = self.data["notes"][str(m)]
        return local if local == intl else "%s (%s)" % (local, intl)

    def span(self, low, high):
        return fill(self.U["rangeValue"], low=self.name(low), high=self.name(high))

    def expect_result(self, label, r, low, high, source="mic", fry=False, whistle=False):
        U, n = self.U, high - low
        local = lambda m: self.data["notes"][str(m)][0]
        self.check(label + ": value", r["value"].startswith(fill(U["rangeValue"], low=local(low), high=local(high))), r["value"])
        semis = fill(U["semitoneOne" if n == 1 else "semitoneMany"], n=n)
        # one decimal shown: English plural rules make every count plural, 1.0 included
        octs = fill(U["octaveMany"], n="%.1f" % (n / 12))
        want = [semis if n < 12 else fill(U["spanValue"], semitones=semis, octaves=octs)]
        if n >= 12:
            types = typical_for(self.data["voiceTypes"], low, high)
            want.append(fill(U["typicalTwo"], first=types[0]["name"], second=types[1]["name"]) if len(types) == 2
                        else types[0]["name"])
        self.check(label + ": span and voice type", r["dd"][:len(want)] == want, r["dd"])
        notes = [U["tooNarrow"]] if n < 12 else [U["mayChange"], U["breakMoreReliable"]]
        if fry:
            notes.append(fill(U["fryFlag"], note=self.name(36)))
        if whistle:
            notes.append(fill(U["whistleFlag"], note=self.name(89)))
        if source == "manual":
            notes.append(U["manualNote"])
        self.check(label + ": hedges and flags", r["notes"] == notes, r["notes"])
        self.check(label + ": keys lit", r["keys"] == n + 1, r["keys"])

    def mic(self, label, fx, ua, platform):
        if any("take" in s for s in fx["segments"]) and not takes_dir():
            print("SKIP %s: no takes folder (set SCALITA_TAKES)" % label)
            return
        wav = scratch() / ("%s.wav" % label.replace(" ", "-"))
        seconds = compose(fx["segments"], wav)
        t0 = time.monotonic()
        browser = self.launch(wav)
        try:
            ctx, page, logs = self.open(browser, ua)
            U, C = self.U, self.C
            page.get_by_role("button", name=C["start"], exact=True).click()
            self.clean(label + " idle", page)
            page.wait_for_function("window.__ev.some((e) => e.phase === 'done')", timeout=int((seconds + 20) * 1000))
            self.clean(label + " locked", page)
            ev = page.evaluate("window.__ev")
            done = next(e for e in ev if e["phase"] == "done")
            self.check(label + ": locked", (done["low"], done["high"]) == (fx["low"], fx["high"]), [done["low"], done["high"]])
            on = next((e["at"] for e in ev if e["micOn"]), None)
            off = next((e["at"] for e in ev if on is not None and e["at"] > on and not e["micOn"]), None)
            self.check(label + ": the mic went off at the lock", on is not None and off is not None, [on, off])
            late = page.evaluate("([a, b]) => performance.getEntriesByType('resource')"
                                 ".filter((e) => e.startTime >= a && e.startTime <= b).map((e) => e.name)", [on, off or 1e12])
            self.check(label + ": nothing fetched while listening", not late, late)
            s = page.evaluate("document.querySelector('[data-tool]').rangeTest.settings") or {}
            self.check(label + ": processing off",
                       [s.get(k) for k in ("echoCancellation", "noiseSuppression", "autoGainControl")] == [False] * 3,
                       {k: s.get(k) for k in ("echoCancellation", "noiseSuppression", "autoGainControl", "sampleRate")})
            self.check(label + ": the track is stopped", page.evaluate("document.querySelector('[data-tool]').rangeTest.micLive()") is False)
            if fx["fry"] or fx["whistle"]:
                hints = page.evaluate("window.__hints")
                want = ([U["fryHint"]] if fx["fry"] else []) + ([fill(U["whistleHint"], note=self.name(89))] if fx["whistle"] else [])
                self.check(label + ": live hints", all(h in hints for h in want), hints)
            seen = time.monotonic()
            page.get_by_role("button", name=U["seeResult"]).click()
            page.wait_for_selector('[data-state="result"]')
            r = page.evaluate(RESULT)
            self.clean(label + " result", page)
            self.expect_result(label, r, fx["low"], fx["high"], fry=fx["fry"], whistle=fx["whistle"])
            rng = self.span(fx["low"], fx["high"])
            if platform == "android":
                self.check(label + ": Android CTA", r["cta"] == fill(U["ctaAndroid"], range=rng) and r["play"] == self.data["playLink"],
                           [r["cta"], r["play"]])
            else:
                self.check(label + ": computer CTA", r["cta"] == fill(U["ctaDesktop"], range=rng) and r["copy"] and not r["play"],
                           [r["cta"], r["copy"], r["play"]])
            page.wait_for_function("!document.querySelector('.share-card__actions .btn:last-child').disabled", timeout=8000)
            self.check(label + ": share card after the result", fetched(seen, "/js/tools/share-card.js") and not fetched(t0, "/audio/"),
                       [p for t, p in Handler.log if t >= t0 and p.startswith(("/audio/", "/js/tools/share"))])
            tap = time.monotonic()
            page.get_by_role("button", name=U["pianoButton"]).click()
            page.wait_for_selector(".tool-panel__state--result .keyboard .key--active", timeout=10000)
            self.check(label + ": piano after its button, mic off",
                       fetched(tap, "/audio/piano-web/") and fetched(t0, "/audio/") == fetched(tap, "/audio/")
                       and page.evaluate("document.querySelector('[data-tool]').rangeTest.micLive()") is False,
                       fetched(t0, "/audio/"))
            self.check(label + ": no layout shift", page.evaluate("window.__cls") < 0.05, page.evaluate("window.__cls"))
            self.check(label + ": console clean", not logs, logs)
            ctx.close()
        finally:
            browser.close()

    def plain(self):
        U, C, M = self.U, self.C, self.M
        browser = self.launch()
        try:
            # In-app browser
            ctx, page, logs = self.open(browser, INSTAGRAM)
            panel = page.locator('[data-tool="vocal-range-test"]')
            self.clean("in-app", page)
            self.check("in-app: open in your browser", C["openInBrowser"] in panel.inner_text(), panel.inner_text()[:200])
            self.check("in-app: copy link, keyboard, try anyway",
                       all(page.get_by_role("button", name=n).count() == 1 for n in (C["copyLink"], U["noMic"], U["tryAnyway"]))
                       and page.get_by_role("button", name=C["start"], exact=True).count() == 0)
            ctx.close()

            # Every error code through a listener that fails with it
            ctx, page, logs = self.open(browser)
            got = page.evaluate("""async (codes) => {
              const mod = await import('/js/tools/vocal-range-test.js');
              const data = JSON.parse(document.getElementById('page-data').textContent);
              const out = {};
              for (const code of codes) {
                const el = document.createElement('div');
                document.body.append(el);
                mod.mount(el, data, { createListener: (o) => ({
                  start() { setTimeout(() => o.onError(code), 0); return Promise.resolve(false); },
                  stop() { return Promise.resolve(); }, settings: null,
                }) });
                el.querySelector('.btn--fill').click();
                for (let i = 0; i < 100 && el.dataset.state !== 'error'; i++) await new Promise((r) => setTimeout(r, 20));
                const p = el.querySelector('.tool-panel__error');
                out[code] = p ? [p.textContent, p.getAttribute('role')] : null;
                el.remove();
              }
              return out;
            }""", ERRORS)
            for code in ERRORS:
                self.check("error %s" % code, got.get(code) == [M[code], "alert"], got.get(code))
            self.check("errors: console clean", not logs, logs)
            ctx.close()
            ctx, page, logs = self.open(browser, init="delete window.AudioWorkletNode;")
            self.clean("no AudioWorklet", page)
            text = page.locator(".tool-panel__error").inner_text()
            self.check("no AudioWorklet: micUnsupported before a tap", text == M["micUnsupported"], text)
            ctx.close()

            # The keyboard path, keys only
            ctx, page, logs = self.open(browser)
            t0 = time.monotonic()
            press = lambda loc: (loc.focus(), page.keyboard.press("Enter"))
            press(page.get_by_role("button", name=U["noMic"]))
            press(page.get_by_role("button", name=U["lowerKeys"]))
            self.check("keyboard: no audio before a key", not fetched(t0, "/audio/"), fetched(t0, "/audio/"))
            key = page.locator('.tool-panel__state--manual .keyboard [data-midi="45"]')
            press(key)
            self.clean("keyboard picker", page)
            page.wait_for_function("document.querySelector('.tool-panel__state--manual .keyboard [data-midi=\"45\"]').getAttribute('aria-pressed') === 'true'")
            page.keyboard.press("ArrowRight")
            moved = page.evaluate("document.activeElement.dataset.midi")
            self.check("keyboard: arrows move along the keys", moved == "46", moved)
            press(page.get_by_role("button", name=C["next"], exact=True))
            press(page.locator('.tool-panel__state--manual .keyboard [data-midi="64"]'))
            press(page.get_by_role("button", name=U["showRange"]))
            page.wait_for_selector('[data-state="result"]')
            page.wait_for_timeout(300)
            self.check("keyboard: a key played the piano", fetched(t0, "/audio/piano-web/"), fetched(t0, "/audio/"))
            self.expect_result("keyboard", page.evaluate(RESULT), 45, 64, source="manual")
            press(page.get_by_role("button", name=C["tryAgain"]))
            idle = page.locator('[data-tool="vocal-range-test"]').inner_text()
            self.check("keyboard: last time shown", fill(U["lastTimeLine"], range=self.span(45, 64)) in idle, idle[-120:])
            press(page.get_by_role("button", name=U["noMic"]))
            press(page.get_by_role("button", name=C["next"], exact=True))
            press(page.get_by_role("button", name=U["lowerKeys"]))
            press(page.locator('.tool-panel__state--manual .keyboard [data-midi="48"]'))
            press(page.get_by_role("button", name=U["showRange"]))
            page.wait_for_selector('[data-state="result"]')
            r = page.evaluate(RESULT)
            self.clean("narrow result", page)
            self.expect_result("narrow", r, 45, 48, source="manual")
            self.check("narrow: last time listed", r["dt"][-1] == C["lastTime"], r["dt"])
            self.check("keyboard: console clean", not logs, logs)
            ctx.close()

            # What a page costs before anyone taps
            ctx = browser.new_context(viewport={"width": 390, "height": 844})
            page = ctx.new_page()
            js = {}
            page.on("response", lambda resp: js.__setitem__(resp.url.split("?")[0], resp)
                    if resp.request.resource_type == "script" else None)
            t0 = time.monotonic()
            page.goto(self.origin + PAGE)
            page.wait_for_selector('[data-state="idle"]')
            page.wait_for_timeout(1500)
            sizes = {u.split("/", 3)[-1]: len(gzip.compress(r.body(), 9)) for u, r in js.items()}
            total = sum(sizes.values())
            self.check("budget: scripts before a tap", sorted(sizes) == ["js/audio/mic.js", "js/tools/vocal-range-test.js"], sizes)
            self.check("budget: under 15 KB gzipped", total < 15 * 1024, total)
            self.check("budget: no audio, no share card", not fetched(t0, "/audio/") and not fetched(t0, "/js/tools/share"),
                       [p for t, p in Handler.log if t >= t0])
            ctx.close()
        finally:
            browser.close()


def main():
    from playwright.sync_api import sync_playwright

    data = page_data("en")
    Handler.page = fixture(data).encode("utf-8")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = "http://127.0.0.1:%d" % server.server_address[1]
    try:
        with sync_playwright() as p:
            run = Run(p, origin, data)
            run.mic("two takes", FX["twoTakes"], ANDROID, "android")
            run.mic("tones", FX["tones"], None, "desktop")
            run.plain()
    finally:
        server.shutdown()
    failed = 0
    for name, ok, got in run.checks:
        print("%s %s%s" % ("ok  " if ok else "FAIL", name, "" if ok or got is None else ": " + json.dumps(got, ensure_ascii=False)[:600]))
        failed += not ok
    print("PASS" if not failed else "FAIL (%d)" % failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
