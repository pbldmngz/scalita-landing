"""js/audio/piano.js and the web samples in headless Chromium.

  python3 -B tool/tests/piano/smoke_test.py    or
  PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider tool/tests/piano/smoke_test.py

Serves the site from the repo root on 127.0.0.1 and opens fixture.html (the
manifest filled in). Chrome for Testing through Playwright, muted. Checks:
- before the tap the page fetches itself and piano.js only, no audio;
- the tap plays a C major scale, C4 to C5, with no console error, sound on a
  meter, and only the band's MP3s requested;
- every MP3 decodes gaplessly: 5 s, the attack within 1 ms of ffmpeg's;
- offline, each scale note is within 20 cents of its pitch, starts on time
  and comes out at the app's level, and a six-note chord does not clip.
"""

import functools
import http.server
import importlib.util
import json
import math
import sys
import threading
from pathlib import Path

sys.dont_write_bytecode = True  # everything in this repo is served: leave no __pycache__
SITE = Path(__file__).resolve().parents[3]
FIXTURE = "/tool/tests/piano/fixture.html"
SCALE = [60, 62, 64, 65, 67, 69, 71, 72]
BAND = [54, 57, 60, 63, 66, 69, 72, 75, 78]  # C4 to C5 plus the 7-semitone margin

spec = importlib.util.spec_from_file_location("render_web_piano", SITE / "tool" / "render_web_piano.py")
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)
MANIFEST = json.loads((SITE / "audio" / "piano-web" / "manifest.json").read_text())
_result = None


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def result():
    global _result
    if _result is not None:
        return _result
    from playwright.sync_api import sync_playwright

    ffmpeg = render.find_ffmpeg()
    expected = {
        n["file"]: render.onset(render.decode(ffmpeg, SITE / "audio" / "piano-web" / n["file"])) / render.RATE * 1000
        for n in MANIFEST["notes"]
    }
    html = (SITE / FIXTURE.lstrip("/")).read_text().replace("__MANIFEST__", json.dumps(MANIFEST))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = "http://127.0.0.1:%d" % server.server_address[1]
    requests, errors = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chromium", headless=True, args=["--mute-audio"])
            page = browser.new_page()
            page.on("request", lambda r: requests.append(r.url[len(origin):]))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.route(origin + FIXTURE, lambda route: route.fulfill(
                status=200, content_type="text/html; charset=utf-8", body=html))
            page.goto(origin + FIXTURE)
            page.wait_for_function("window.fixtureReady === true")
            page.wait_for_timeout(500)
            before = list(requests)
            page.click("#play")
            page.wait_for_function("window.realtime !== undefined", timeout=30000)
            tapped = requests[len(before):]
            realtime = page.evaluate("window.realtime")
            decoded = page.evaluate("expected => window.decodeCheck(expected)", expected)
            offline = page.evaluate("window.offlineCheck()")
            version = browser.version
            browser.close()
    finally:
        server.shutdown()
    _result = dict(before=before, tapped=tapped, realtime=realtime, decoded=decoded,
                   offline=offline, errors=errors, version=version)
    return _result


def test_no_audio_before_the_tap():
    r = result()
    assert sorted(r["before"]) == sorted([FIXTURE, "/js/audio/piano.js"]), r["before"]


def test_the_tap_loads_only_the_band():
    files = sorted(u.split("?")[0] for u in result()["tapped"])
    assert all(u.startswith("/audio/piano-web/") for u in files), files
    assert files == sorted("/audio/piano-web/%s.mp3" % render.app_name(m) for m in BAND), files


def test_scale_plays_without_errors():
    r = result()
    rt = r["realtime"]
    assert r["errors"] == [], r["errors"]
    assert rt["ready"] is True and rt["busy"] is True and rt["state"] == "running", rt
    assert rt["peak"] > 0.05, "the meter heard %.4f" % rt["peak"]
    for i, (v, midi) in enumerate(zip(rt["voices"], SCALE)):
        shift = midi - v["sample"]
        assert v["midi"] == midi and abs(shift) <= 1 and v["sample"] % 3 == 0, v
        assert abs(v["rate"] - 2 ** (shift / 12)) < 1e-12, v
        assert abs(v["start"] - i * 0.4) < 1e-6, v


def test_every_mp3_decodes_gaplessly():
    for name, d in result()["decoded"].items():
        assert abs(d["seconds"] - 5.0) < 0.001, (name, d)
        assert abs(d["onsetMs"] - d["expectedOnsetMs"]) <= 1.0, (name, d)
        assert 0.2 < d["peak"] < 1.0, (name, d)


def test_offline_pitch_timing_and_level():
    off = result()["offline"]
    for n in off["notes"]:
        assert abs(n["cents"]) <= 20, n
        assert abs(n["onsetLagMs"]) <= 1.0, n
        a = n["srcPeak"] * math.sqrt(0.5)
        want = 0.95 * (0.87 * a - 0.1 * a ** 3)
        assert abs(n["outPeak"] / want - 1) < 0.03, (n, want)
    wall = 0.95 * 0.9862875
    assert 0.5 < off["chordPeak"] <= wall + 1e-6, off["chordPeak"]


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except AssertionError as e:
                failed += 1
                print("FAIL", name, e)
    r = result()
    print("Chromium %s; meter peak %.3f; chord peak %.3f; cents %s" % (
        r["version"], r["realtime"]["peak"], r["offline"]["chordPeak"],
        " ".join("%+.1f" % n["cents"] for n in r["offline"]["notes"])))
    sys.exit(1 if failed else 0)
