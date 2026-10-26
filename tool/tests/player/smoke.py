"""The warm-up piano and the voice break finder in headless browsers.

    python3 tool/tests/player/smoke.py              # Chromium
    python3 tool/tests/player/smoke.py --webkit     # and a WebKit pass

Builds each fixture page in memory from `tool/build.py --page-data` (no
template needed, nothing written), serves it with the repo's js/, css/,
fonts/ and audio/, and checks with data-rate="25":

- nothing under /audio/ is fetched before the first Play or voice answer;
- the player is keyboard operable: Tab to Tenor, Enter, Tab to Play, Enter;
- Pre-Performance Quick for the tenor preset plays exactly the roots of
  routines.json, step by step, and ends;
- a custom range on the five-note page plays the roots of the matching
  step_range_vectors.json case;
- Stop silences it: no event after it, the button reads Play again;
- the chooser switches between a routine and a scale;
- the finder climbs from its start note, takes the press, confirms, adjusts
  and gives the type voice_type.dart gives, and keeps it in localStorage;
- no console error or warning, no page error.
"""
import http.server
import json
import os
import subprocess
import sys
import threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
DATA = os.path.join(REPO, 'tool', 'data', 'app')
RATE = 25


def page_data(page_id, locale='en'):
    out = subprocess.run(
        [sys.executable, os.path.join(REPO, 'tool', 'build.py'), '--allow-missing',
         '--page-data', page_id, '--locale', locale],
        check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def fixture(pd, body, tool):
    safe = json.dumps(pd, ensure_ascii=False).replace('<', '\\u003c')
    imports = json.dumps({'imports': pd['assets']}).replace('<', '\\u003c')
    src = pd['assets']['/js/tools/%s.js' % tool]
    return ("""<!doctype html><html lang="%s"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>player fixture</title><link rel="icon" href="data:,">
<link rel="stylesheet" href="/css/style.css">
<script type="importmap">%s</script>
<script type="module" src="%s"></script></head>
<body><main id="main"><div class="container">%s</div></main>
<script type="application/json" id="page-data">%s</script>
<script>window.log = []; window.addEventListener('scalita:player', (e) => window.log.push(e.detail), true);
window.addEventListener('scalita:finder', (e) => window.log.push(e.detail), true);</script>
</body></html>""" % (pd['lang'], imports, src, body, safe)).encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    pages = {}
    requests = []

    def __init__(self, *a, **k):
        super().__init__(*a, directory=REPO, **k)

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        Handler.requests.append(path)
        if path in Handler.pages:
            body = Handler.pages[path]
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if not path.startswith(('/js/', '/css/', '/fonts/', '/audio/')):
            return self.send_error(404)
        return super().do_GET()


def load(name):
    return json.load(open(os.path.join(DATA, name), encoding='utf-8'))


def main():
    webkit = '--webkit' in sys.argv
    routines = {r['id']: r for r in load('routines.json')}
    vectors = load('step_range_vectors.json')
    voice_vectors = load('voice_type_vectors.json')['closestForPrimoAndGender']

    pre = page_data('quick-vocal-warm-up')
    five = page_data('five-note-scale')
    finder = page_data('voice-break-finder')
    chooser = dict(pre)
    chooser['players'] = {'main': {'kind': 'chooser', 'items': [pre['players']['main'], five['players']['main']],
                                   'selected': 'scale:five_note'}}
    mount = '<div class="player" data-tool="player" data-player="main" data-rate="%d"></div>' % RATE
    Handler.pages = {
        '/pre.html': fixture(pre, mount, 'player'),
        '/five.html': fixture(five, mount, 'player'),
        '/chooser.html': fixture(chooser, mount, 'player'),
        '/finder.html': fixture(finder, '<div class="tool-panel" data-tool="voice-break-finder" data-rate="10"></div>',
                                'voice-break-finder'),
    }
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    results = []

    def check(name, ok, got=''):
        results.append(ok)
        print('%s %s%s' % ('ok  ' if ok else 'FAIL', name, '' if ok else ': ' + json.dumps(got)[:600]))

    def audio_requests():
        return [p for p in Handler.requests if p.startswith('/audio/')]

    try:
        with sync_playwright() as p:
            engines = [('chromium', p.chromium)] + ([('webkit', p.webkit)] if webkit else [])
            for engine, kind in engines:
                print('-- %s' % engine)
                try:
                    browser = kind.launch(headless=True)
                except Exception as e:  # a browser not installed
                    print('SKIP %s: %s' % (engine, str(e).splitlines()[0]))
                    continue
                logs = []

                def fresh():
                    ctx = browser.new_context()
                    page = ctx.new_page()
                    page.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
                    page.on('pageerror', lambda e: logs.append('pageerror: ' + str(e)))
                    return ctx, page

                # 1. the routine page, by keyboard, for the tenor preset
                Handler.requests = []
                ctx, page = fresh()
                page.goto(base + '/pre.html')
                page.wait_for_selector('.player__preset')
                labels = page.eval_on_selector_all('.player__preset', 'b => b.map(x => x.textContent)')
                check('seven voice buttons', len(labels) == 7, labels)
                check('nothing under /audio/ before Play', not audio_requests(), audio_requests())
                status = page.text_content('.player__status')
                check('asks for a voice first', pre['strings']['player']['pickVoice'] in status, status)
                tenor = next(v['name'] for v in pre['voiceTypes'] if v['id'] == 'tenor')
                for _ in range(12):
                    page.keyboard.press('Tab')
                    if page.evaluate('document.activeElement.textContent') == tenor:
                        break
                check('Tab reaches Tenor', page.evaluate('document.activeElement.textContent') == tenor)
                page.keyboard.press('Enter')
                check('Enter picks it', page.get_attribute('.player__preset[data-voice="tenor"]', 'aria-pressed') == 'true')
                for _ in range(8):
                    page.keyboard.press('Tab')
                    if page.evaluate("document.activeElement.classList.contains('btn--fill')"):
                        break
                check('Tab reaches Play', page.evaluate("document.activeElement.textContent") == pre['strings']['common']['play'])
                page.keyboard.press('Enter')
                page.wait_for_function("window.log.some(e => e.type === 'end')", timeout=90000)
                log = page.evaluate('window.log')
                keys = [[e['step'], e['root']] for e in log if e['type'] == 'key']
                want = [[i, r] for i, roots in enumerate(routines['pre_performance']['presets']['tenor']['roots']) for r in roots]
                check('tenor plays the exact preset roots', keys == want, {'got': keys[:12], 'want': want[:12], 'n': [len(keys), len(want)]})
                steps = [e['step'] for e in log if e['type'] == 'step']
                check('every step, in order', steps == list(range(len(routines['pre_performance']['steps']))), steps)
                firsts = [e['type'] for e in log if e['type'] in ('chord', 'key')][:2]
                check('the first key opens without its chord', firsts[0] == 'key', firsts)
                pauses = [e['left'] for e in log if e['type'] == 'pause']
                check('a breathing pause between steps', pauses[:3] == [3, 2, 1] and len(pauses) == 3 * (len(steps) - 1), pauses)
                got_audio = audio_requests()
                check('only piano samples were fetched', bool(got_audio) and all(a.startswith('/audio/piano-web/') and a.endswith('.mp3') for a in got_audio), got_audio)
                check('done, and Play again', page.text_content('.player .btn--fill') == pre['strings']['common']['play'])
                current = page.eval_on_selector_all('.player__steps [aria-current]', 'x => x.length')
                check('no step left marked after the end', current == 0, current)

                # Stop, mid-way
                page.evaluate('window.log = []')
                page.click('.player .btn--fill')
                page.wait_for_function("window.log.filter(e => e.type === 'note').length > 20", timeout=30000)
                page.click('.player .btn--fill')
                n = page.evaluate('window.log.length')
                page.wait_for_timeout(600)
                check('Stop ends the events', page.evaluate('window.log.length') == n, page.evaluate('window.log.length') - n)
                check('Stop gives Play back', page.text_content('.player .btn--fill') == pre['strings']['common']['play'])
                lit = page.eval_on_selector_all('.player .key--active', 'x => x.length')
                check('no key left lit', lit == 0, lit)
                ctx.close()

                # 2. a custom range on the five-note scale, one of the app's vectors
                # with the voice break the finder would have kept, when the case has one
                case = next(v for v in vectors if v['input']['kind'] == 'scale' and v['input']['scaleId'] == 'five_note'
                            and 36 <= v['input']['rangeLow'] and v['input']['rangeHigh'] <= 88
                            and v['input']['rangeHigh'] - v['input']['rangeLow'] >= 5)
                ctx, page = fresh()
                if case['input']['primo'] is not None:
                    ctx.add_init_script("localStorage.setItem('scalita-voice-break', %s)" % json.dumps(json.dumps(
                        {'primo': case['input']['primo'], 'secondo': case['input']['secondo']})))
                page.goto(base + '/five.html')
                page.wait_for_selector('.player__preset')
                page.click('.player__preset[data-voice="custom"]')
                page.select_option('.player__custom label:nth-of-type(1) select', str(case['input']['rangeLow']))
                page.select_option('.player__custom label:nth-of-type(2) select', str(case['input']['rangeHigh']))
                page.click('.player .btn--fill')
                page.wait_for_function("window.log.some(e => e.type === 'end')", timeout=60000)
                log = page.evaluate('window.log')
                roots = [e['root'] for e in log if e['type'] == 'key']
                check('custom %d..%d plays the vector roots' % (case['input']['rangeLow'], case['input']['rangeHigh']),
                      roots == case['roots'], {'got': roots, 'want': case['roots']})
                firsts = [e['type'] for e in log if e['type'] in ('chord', 'key')][:2]
                check('a single scale opens on its chord', firsts == ['chord', 'key'], firsts)
                ctx.close()

                # 3. the chooser
                ctx, page = fresh()
                page.goto(base + '/chooser.html')
                page.wait_for_selector('.player__chooser select')
                hidden = page.eval_on_selector('.player__steps', 'x => x.hidden')
                check('chooser opens on the selected scale', hidden, hidden)
                page.select_option('.player__chooser select', 'routine:pre_performance')
                n = page.eval_on_selector_all('.player__steps li', 'x => x.length')
                check('chooser switches to the routine', n == len(routines['pre_performance']['steps']), n)
                page.click('.player__preset[data-voice="bass"]')
                meta = page.text_content('.player__meta')
                minutes = routines['pre_performance']['presets']['bass']['minutes']
                check('the bass preset shows the app minutes', str(minutes) in meta, meta)
                ctx.close()

                # 4. the voice break finder, by keyboard
                Handler.requests = []
                ctx, page = fresh()
                page.goto(base + '/finder.html')
                page.wait_for_selector('[data-tool="voice-break-finder"][data-state="intro"]')
                check('finder: nothing fetched before the answer', not audio_requests(), audio_requests())
                page.focus('[data-tool="voice-break-finder"] .btn--fill')
                page.keyboard.press('Enter')
                page.wait_for_selector('[data-state="voice"]')
                page.keyboard.press('Enter')  # focus is on Lower voice
                page.wait_for_function("window.log.filter(e => e.type === 'note').length >= 5", timeout=30000)
                notes = [e['midi'] for e in page.evaluate('window.log') if e['type'] == 'note']
                check('lower voice climbs from C3 a semitone at a time', notes[:5] == [48, 49, 50, 51, 52], notes)
                page.keyboard.press('Space')  # focus is on I felt the shift
                page.wait_for_selector('[data-state="confirming"]')
                felt = next(e['midi'] for e in page.evaluate('window.log') if e['type'] == 'felt')
                title = page.text_content('.tool-panel__state:not([hidden]) h3')
                note = finder['notes'][str(felt)][0]
                check('confirm names the note', note in title, title)
                page.click('text=' + finder['strings']['voice-break-finder']['aBitHigher'])
                page.click('text=' + finder['strings']['voice-break-finder']['yes'])
                page.wait_for_selector('[data-state="result"]')
                res = next(e for e in page.evaluate('window.log') if e['type'] == 'result')
                want = next(v['type'] for v in voice_vectors if v['primo'] == felt + 1 and v['isMaleVoice'])
                check('the result is voice_type.dart', res['primo'] == felt + 1 and res['voiceType'] == want, [res, want])
                saved = page.evaluate("JSON.parse(localStorage.getItem('scalita-voice-break'))")
                check('kept in this browser', saved and saved['primo'] == felt + 1, saved)
                check('finder fetched only piano samples', all(a.startswith('/audio/piano-web/') for a in audio_requests()), audio_requests())
                ctx.close()

                check('%s console clean' % engine, not logs, logs)
                logs.clear()
                browser.close()
    finally:
        srv.shutdown()
    print('PASS' if all(results) else 'FAIL')
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(main())
