"""The listener in a real browser, fed a real take through Chromium's fake mic.

    python3 tool/tests/parity/fakemic.py

Pads the take in fixtures.json (fakeMic) with silence into a scratch folder
(SCALITA_SCRATCH, else the temp folder; never this repo: after %noloop
Chrome repeats its last buffer, and YIN would read that as a note), serves
js/audio and a generated page from memory, clicks Start, and checks:
getSettings() has the three processing flags off, the locked notes and the
note runs match the fixture, nothing was fetched once listening began, and
the console stayed clean. Needs Playwright for Python with its Chromium.
"""
import functools
import http.server
import json
import os
import sys
import tempfile
import threading
import wave

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
FIXTURES = json.load(open(os.path.join(HERE, 'fixtures.json'), encoding='utf-8'))
FX = FIXTURES['fakeMic']

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>fake mic</title></head>
<body><button id="go">go</button><script type="module">
import { createListener } from '/js/audio/listener.js';
import { NoteLock } from '/js/audio/pitch.js';
import { noteRuns } from '/tool/tests/parity/runs.mjs';
const SECONDS = %(seconds)s, MIN_MS = %(minMs)s;
window.result = null;
document.getElementById('go').addEventListener('click', () => {
  const readings = [], locked = [], hints = [], errors = [], states = [];
  const lock = new NoteLock();
  let listeningAt = null;
  const listener = createListener({
    onReading(r) { readings.push(r); const m = lock.push(r); if (m !== null) locked.push(m); },
    onError(code) { errors.push(code); },
    onHint(code, on) { hints.push(code + (on ? '+' : '-')); },
    onState(s) { states.push(s); if (s === 'listening') listeningAt = performance.now(); },
  });
  listener.start().then(async (ok) => {
    const settings = listener.settings, rate = listener.sampleRate;
    if (ok) await new Promise((r) => setTimeout(r, SECONDS * 1000));
    await listener.stop();
    const late = performance.getEntriesByType('resource')
      .filter((e) => listeningAt !== null && e.startTime > listeningAt).map((e) => e.name);
    window.result = {
      ok, settings, rate, locked, hints, errors, states, late,
      runs: noteRuns(readings, { minMs: MIN_MS, windowSec: 2048 / rate }),
      readings: readings.length, believed: readings.filter((r) => r.hz !== null).length,
    };
  });
});
</script></body></html>"""


def takes_dir():
    d = os.environ.get('SCALITA_TAKES') or os.path.normpath(os.path.join(HERE, FIXTURES['takesDir']))
    return d if os.path.isdir(d) else None


def padded_take(src, out_dir):
    with wave.open(src, 'rb') as w:
        rate, width, channels = w.getframerate(), w.getsampwidth(), w.getnchannels()
        frames = w.readframes(w.getnframes())
    silence = lambda ms: b'\0' * (int(rate * ms / 1000) * width * channels)
    data = silence(FX['padBeforeMs']) + frames + silence(FX['padAfterMs'])
    path = os.path.join(out_dir, 'fakemic-' + os.path.basename(src))
    with wave.open(path, 'wb') as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(data)
    return path, len(data) / (rate * width * channels)


class Handler(http.server.SimpleHTTPRequestHandler):
    page = b''

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/favicon.ico':
            self.send_response(204)
            return self.end_headers()
        if path == '/':
            body, kind = self.page, 'text/html'
        elif (path.startswith('/js/audio/') and path.endswith('.js')) or path == '/tool/tests/parity/runs.mjs':
            try:
                body = open(os.path.join(REPO, path.lstrip('/')), 'rb').read()
            except OSError:
                return self.send_error(404)
            kind = 'text/javascript'
        else:
            return self.send_error(404)
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    takes = takes_dir()
    if not takes:
        print('SKIP: no takes folder (set SCALITA_TAKES or check out scalita_app next to this repo)')
        return 0
    out_dir = os.path.join(os.environ.get('SCALITA_SCRATCH') or os.path.join(tempfile.gettempdir(), 'scalita-tests'), 'fakemic')
    os.makedirs(out_dir, exist_ok=True)
    wav, seconds = padded_take(os.path.join(takes, FX['take']), out_dir)
    Handler.page = (PAGE % {'seconds': round(seconds + 0.5, 2), 'minMs': FX['noteRunMinMs']}).encode()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = 'http://127.0.0.1:%d/' % srv.server_address[1]
    args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
            '--use-file-for-fake-audio-capture=%s%%noloop' % wav]
    logs = []
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(channel='chromium', headless=True, args=args)
            except Exception:
                browser = p.chromium.launch(headless=True, args=args)
            page = browser.new_page()
            page.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda e: logs.append('pageerror: ' + str(e)))
            page.goto(url)
            page.click('#go')
            page.wait_for_function('window.result !== null', timeout=int((seconds + 30) * 1000))
            r = page.evaluate('window.result')
            version = browser.version
            browser.close()
    finally:
        srv.shutdown()

    s = r['settings'] or {}
    checks = [
        ('started', r['ok'] and not r['errors'], r['errors']),
        ('echoCancellation off', s.get('echoCancellation') is False, s.get('echoCancellation')),
        ('noiseSuppression off', s.get('noiseSuppression') is False, s.get('noiseSuppression')),
        ('autoGainControl off', s.get('autoGainControl') is False, s.get('autoGainControl')),
        ('locked notes', r['locked'] == FX['lockedNotes'], r['locked']),
        ('note runs', r['runs'] == FX['noteRuns'], r['runs']),
        ('nothing fetched while listening', not r['late'], r['late']),
        ('console clean', not logs, logs),
    ]
    print('chromium %s, context %d Hz, track %s, %d readings, %d believed, hints %s' % (
        version, r['rate'], json.dumps({k: s.get(k) for k in ('sampleRate', 'channelCount')}),
        r['readings'], r['believed'], r['hints']))
    failed = 0
    for name, ok, got in checks:
        print('%s %s: %s' % ('ok  ' if ok else 'FAIL', name, json.dumps(got)))
        failed += not ok
    print('PASS' if not failed else 'FAIL')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
