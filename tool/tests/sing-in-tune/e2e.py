"""The sing-in-tune tool in headless Chromium, with a fake microphone.

    python3 -B tool/tests/sing-in-tune/e2e.py

Writes two steady tones, A4 and A4 20 cents sharp, each with a few
harmonics like a hummed note, to a scratch folder (SCALITA_SCRATCH, else the
temp folder; never this repo). Takes the page data from build.py
--page-data (which writes nothing), serves js/, css/, audio/ and fonts/ from
the repo around a page holding the tool's mount point, and checks:

- before the first tap only sing-in-tune-test.js (the mount point, the
  toolId's file that build.py loads) and mic.js arrive, no audio;
- sing this note, the A4 tone against A3 and A4: near zero cents, five of
  five within 10 cents, the A3 notes sung "an octave up";
- the same 20 cents sharp: about 20 cents, and "Most of them were high";
- the turn-taking: no piano voice started or still scheduled while a
  microphone track was live (watched from outside the tool, every 2 ms, on
  the AudioContext's clock), and the tool's own turn hooks agree;
- nothing fetched while a microphone track was live;
- the free tuner reads the A4 tone as A4 within 2 cents;
- the Android-only line off Android, the tagged Play link on it;
- hear it again replays the note, and the turns still never overlap;
- last time shows on the next visit;
- the free tuner, with reduced motion, keeps working;
- higher or lower by keyboard alone: three right answers give 3 of 3, and
  no microphone;
- the range test's saved range picks the notes, and Stop silences both;
- a tab sent to the background stops the round with its mic.json string;
- an in-app browser gets the open-in-your-browser panel;
- refused microphones show their mic.json strings;
- nothing wider than a 360 px screen, and a clean console.

    python3 -B tool/tests/sing-in-tune/e2e.py --site DIR

runs the same against a site built with build.py --out DIR, on its real
tool page. Screenshots go to the scratch folder. Needs Playwright for Python
and its Chromium.
"""
import array
import functools
import http.server
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import threading
import wave

sys.dont_write_bytecode = True  # everything in this repo is served: leave no __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
SCRATCH = os.path.join(os.environ.get('SCALITA_SCRATCH') or os.path.join(tempfile.gettempdir(), 'scalita-tests'),
                       'sing-in-tune')
SERVED = ('/js/', '/css/', '/audio/', '/fonts/', '/images/')
LT = chr(92) + 'u003c'  # "<" written as a JSON escape, so no tag can close early
UI = json.load(open(os.path.join(REPO, 'tool/content/ui/en/sing-in-tune-test.json'), encoding='utf-8'))
COMMON = json.load(open(os.path.join(REPO, 'tool/content/ui/en/common.json'), encoding='utf-8'))
MIC = json.load(open(os.path.join(REPO, 'tool/content/ui/en/mic.json'), encoding='utf-8'))
BEFORE_TAP = ['/js/audio/mic.js', '/js/tools/sing-in-tune-test.js']
CHROME_JS = '/js/site/chrome.js'  # a built page's own script, every page's, before any tap
ANDROID = ('Mozilla/5.0 (Linux; Android 14; SM-A725F) AppleWebKit/537.36 (KHTML, like Gecko) '
           'Chrome/141.0.0.0 Mobile Safari/537.36')
PATH = '/'  # the harness page, or the built tool page with --site
INSTAGRAM = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
             'Mobile/15E148 Instagram 390.0.0.27.79 (iPhone15,2; iOS 18_5; en_US)')

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sing-in-tune e2e</title>
<link rel="stylesheet" href="/css/style.css">
<script type="importmap">%(importmap)s</script>
<script type="module" src="%(script)s"></script>
</head><body>
<main id="main"><section><div class="container">
<div class="tool-panel" data-tool="sing-in-tune-test"></div>
</div></section></main>
<script type="application/json" id="page-data">%(pd)s</script>
</body></html>"""

# Runs before any page script: the tool's test hook, and a watch on every
# microphone track and every piano voice that does not trust the tool.
PROBE = """(() => {
  window.__scalitaTest = Object.assign({ events: [] }, %(config)s);
  const P = window.__probe = { gum: 0, spans: [], voices: [], violations: [] };
  const tracks = [];
  const live = () => tracks.some((t) => t.readyState === 'live');
  P.live = live;
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      P.gum++;
      const s = await orig(c);
      for (const t of s.getAudioTracks()) {
        const span = [performance.now(), null];
        P.spans.push(span);
        tracks.push(t);
        t.addEventListener('ended', () => { if (span[1] === null) span[1] = performance.now(); });
        const stop = t.stop.bind(t);
        t.stop = () => { if (span[1] === null) span[1] = performance.now(); stop(); };
      }
      return s;
    };
  }
  const real = (node) => node.buffer && node.buffer.length > 1; // not the one-sample unlock
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...rest) {
    const c = this.context;
    if (real(this)) {
      const from = Math.max(when || 0, c.currentTime);
      P.voices.push({ node: this, c, from, to: from + this.buffer.duration / (this.playbackRate.value || 1) });
      if (live()) P.violations.push('a piano voice started while the microphone was live');
    }
    return start.call(this, when, ...rest);
  };
  const stopNode = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (when) {
    for (const v of P.voices) if (v.node === this) v.to = Math.min(v.to, Math.max(when || 0, v.c.currentTime));
    return stopNode.call(this, when);
  };
  setInterval(() => {
    if (!live()) return;
    for (const v of P.voices) {
      if (v.c.state !== 'closed' && v.c.currentTime < v.to - 0.003) {
        P.violations.push('a piano voice was scheduled while the microphone was live');
        v.to = 0;
      }
    }
  }, 2);
})();"""


def tone(path, hz, seconds=70.0, rate=44100, lead=0.3, tail=2.0):
    """A steady hum: hz and three harmonics, after `lead` seconds of silence,
    then `tail` of silence (after %noloop Chrome repeats its last buffer)."""
    if os.path.exists(path):
        return path
    n, w = int(seconds * rate), 2 * math.pi * hz / rate
    pad = array.array('h', bytes(2 * int(lead * rate)))
    body = array.array('h', bytes(2 * n))
    for i in range(n):
        x = i * w
        body[i] = int(9000 * (math.sin(x) + 0.5 * math.sin(2 * x) + 0.25 * math.sin(3 * x) + 0.12 * math.sin(4 * x)))
    with wave.open(path, 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(pad.tobytes() + body.tobytes() + bytes(2 * int(tail * rate)))
    return path


def page_data():
    out = subprocess.run([sys.executable, '-B', os.path.join(REPO, 'tool', 'build.py'), '--allow-missing',
                          '--page-data', 'sing-in-tune-test', '--locale', 'en'],
                         cwd=REPO, capture_output=True, text=True, check=True)
    pd = json.loads(out.stdout)
    assert pd['strings'].get('sing-in-tune-test'), 'the page data has no sing-in-tune-test strings'
    return pd


class Handler(http.server.SimpleHTTPRequestHandler):
    page = b''
    site = None  # --site: serve a built site as it is

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if self.site:
            return super().do_GET()
        if path == '/':
            body = self.page
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if path == '/favicon.ico':
            self.send_response(204)
            return self.end_headers()
        if not path.startswith(SERVED) or '..' in path:
            return self.send_error(404)
        return super().do_GET()


class Run:
    def __init__(self, p, origin, wav=None, ua=None, config=None, extra_init=None, width=390, reduced=False):
        args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--mute-audio']
        if wav:
            args.append('--use-file-for-fake-audio-capture=%s%%noloop' % wav)
        try:
            self.browser = p.chromium.launch(channel='chromium', headless=True, args=args)
        except Exception:
            self.browser = p.chromium.launch(headless=True, args=args)
        opts = {'viewport': {'width': width, 'height': 800}}
        if reduced:
            opts['reduced_motion'] = 'reduce'
        if ua:
            opts['user_agent'] = ua
        self.context = self.browser.new_context(**opts)
        self.context.add_init_script(PROBE % {'config': json.dumps(config or {})})
        if extra_init:
            self.context.add_init_script(extra_init)
        self.page = self.context.new_page()
        self.logs = []
        self.page.on('console', lambda m: self.logs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        self.page.on('pageerror', lambda e: self.logs.append('pageerror: ' + str(e)))
        self.page.goto(origin + PATH)
        self.page.wait_for_selector('[data-tool="sing-in-tune-test"][data-state="idle"] .tool-panel__actions .btn')

    def shot(self, name):
        self.page.screenshot(path=os.path.join(SCRATCH, name + '.png'), full_page=True)

    def chip(self, label):
        self.page.click('.seg[data-mode] >> text="%s"' % label)

    def start(self):
        self.page.click('.tool-panel__state--idle:not([hidden]) button >> text="%s"' % COMMON['start'])

    def eval(self, js):
        return self.page.evaluate(js)

    def overflow(self):
        return self.eval('document.documentElement.scrollWidth - window.innerWidth')

    def close(self):
        self.browser.close()


def resources(run):
    return run.eval("performance.getEntriesByType('resource').map((e) => [new URL(e.name).pathname, e.startTime])")


def fetched_while_live(run):
    spans = run.eval('window.__probe.spans.map((s) => [s[0], s[1] === null ? Infinity : s[1]])')
    return [p for p, t in resources(run) if any(a <= t <= b for a, b in spans)]


def turns(run):
    """The tool's own hooks: the piano never with a live mic, the mic never
    with a busy piano. Returns the broken ones."""
    ev = run.eval('window.__scalitaTest.events')
    return [e for e in ev if (e['kind'] == 'piano' and e['micLive']) or (e['kind'] == 'mic' and e['pianoBusy'])], ev


def result_text(run):
    return run.eval("""(() => {
      const r = document.querySelector('.tool-panel__state--result:not([hidden])');
      if (!r) return null;
      const pairs = [...r.querySelectorAll('.result-card__facts > div')]
        .map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]);
      const cards = [...r.querySelectorAll('.notecard')].map((li) => [li.querySelector('.notecard__note').textContent, li.title]);
      return { value: (r.querySelector('.result-card__value') || {}).textContent || '', pairs, cards,
               facts: Object.fromEntries(pairs), notes: [...r.querySelectorAll('.result-card__note')].map((p) => p.textContent) };
    })()""")


def sing_round(p, origin, wav, targets, label, ua=None, again=False):
    run = Run(p, origin, wav=wav, config={'targets': targets, 'seed': 7}, width=360, ua=ua)
    checks = []
    before = [r for r, _ in resources(run)]
    checks.append(('%s: before the tap only the mount point and mic.js' % label,
                   sorted(x for x in before if x.startswith('/js/')) == sorted(BEFORE_TAP + ([CHROME_JS] if PATH != '/' else []))
                   and not any(x.startswith('/audio/') for x in before), before))
    checks.append(('%s: idle fits 360 px' % label, run.overflow() <= 0, run.overflow()))
    run.shot(label + '-idle')
    run.start()
    run.page.wait_for_selector('.tool-panel__state--run:not([hidden]) .pitch-trail canvas')
    run.page.wait_for_function("document.querySelector('.tool-panel__state--run:not([hidden]) .tool-panel__status')"
                               ".textContent.startsWith('Note')", timeout=20000)
    if again:
        run.page.click('.tool-panel__state--run button:not([disabled]) >> text="%s"' % UI['sing']['again'], timeout=20000)
    run.page.wait_for_timeout(2500)
    checks.append(('%s: the run fits 360 px' % label, run.overflow() <= 0, run.overflow()))
    run.shot(label + '-run')
    run.page.wait_for_selector('.tool-panel__state--result:not([hidden])', timeout=90000)
    checks.append(('%s: the result fits 360 px' % label, run.overflow() <= 0, run.overflow()))
    run.shot(label + '-result')
    res = result_text(run)
    broken, ev = turns(run)
    violations = run.eval('window.__probe.violations')
    checks += [
        ('%s: never both, watched from outside' % label, not violations, violations),
        ('%s: never both, by the tool\'s own turns' % label,
         not broken and sum(e['kind'] == 'piano' for e in ev) == len(targets) + again
         and sum(e['kind'] == 'mic' for e in ev) == len(targets) + 1 + again, [e['kind'] for e in ev]),
        ('%s: one microphone check, then one opening per note%s' % (label, ', one more to hear it again' if again else ''),
         run.eval('window.__probe.gum') == len(targets) + 1 + again, run.eval('window.__probe.gum')),
        ('%s: nothing fetched while the microphone was live' % label, not fetched_while_live(run), fetched_while_live(run)),
        ('%s: the microphone is off at the end' % label, not run.eval('window.__probe.live()'), None),
    ]
    run.result = res
    run.checks = checks
    return run


def cta(run):
    return run.eval("""(() => {
      const r = document.querySelector('.tool-panel__state--result:not([hidden])');
      const a = r.querySelector('a.btn-primary');
      return { href: a ? a.href : null, text: r.textContent };
    })()""")


def idle_text(run):
    return run.eval("document.querySelector('.tool-panel__state--idle:not([hidden])').textContent")


def ear_by_keyboard(run, label):
    """The listening check with the keyboard alone: Enter and Tab."""
    run.page.focus('.seg[data-mode="ear"]')
    run.page.keyboard.press('Enter')
    run.page.keyboard.press('Tab')
    run.page.keyboard.press('Enter')
    for k in range(3):
        run.page.wait_for_function("document.activeElement && document.activeElement.textContent === %s && !document.activeElement.disabled"
                                   % json.dumps(UI['ear']['higher']), timeout=15000)
        up = run.eval('window.__scalitaTest.events.filter((e) => e.pair === %d).pop().up' % k)
        if not up:
            run.page.keyboard.press('Tab')
        run.page.keyboard.press('Enter')
        run.page.wait_for_function("document.activeElement && document.activeElement.textContent === %s"
                                   % json.dumps(COMMON['next']), timeout=5000)
        run.page.keyboard.press('Enter')
    run.page.wait_for_selector('.tool-panel__state--result:not([hidden])')
    return result_text(run), run.eval('document.activeElement.textContent')


def fmt_note(n, total=5):
    return UI['sing']['noteOf'].replace('{n}', str(n)).replace('{total}', str(total))


def cents_of(text):
    m = re.match(r'([+-]?\d+)c', text.replace(chr(0x2212), '-'))
    return int(m.group(1)) if m else None


def main():
    global PATH
    site = sys.argv[sys.argv.index('--site') + 1] if '--site' in sys.argv else None
    os.makedirs(SCRATCH, exist_ok=True)
    from playwright.sync_api import sync_playwright

    a4 = tone(os.path.join(SCRATCH, 'tone-440.wav'), 440.0)
    sharp = tone(os.path.join(SCRATCH, 'tone-440-plus20c.wav'), 440.0 * 2 ** (20 / 1200))
    pd = page_data()
    # The script a built page loads for the mount point: /js/tools/<toolId>.js
    script = pd['assets']['/js/tools/sing-in-tune-test.js']
    Handler.page = (PAGE % {
        'importmap': json.dumps({'imports': pd['assets']}).replace('<', LT),
        'script': script,
        'pd': json.dumps(pd, ensure_ascii=False).replace('<', LT),
    }).encode('utf-8')
    if site:
        Handler.site = site
        PATH = pd['links']['sing-in-tune-test']
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=site or REPO))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = 'http://127.0.0.1:%d' % srv.server_address[1]
    checks, logs = [], []
    up = UI['offset']['octaveUp'].split('}', 1)[1]  # ", an octave up"
    try:
        with sync_playwright() as p:
            # 1. Sing this note, A4 against A3 and A4: the octave folds away
            run = sing_round(p, origin, a4, [57, 69, 57, 69, 57], 'sing-a4')
            r = run.result
            checks += run.checks
            off = cents_of(r['value'])
            checks += [
                ('sing-a4: near zero cents', off is not None and abs(off) <= 2, r['value']),
                ('sing-a4: five of five within 10 cents', r['facts'].get(UI['result']['within10']) == '5 of 5', r['facts']),
                ('sing-a4: the A3 notes an octave up, the A4 ones not',
                 [v.endswith(up) for k, v in r['cards'] if k in ('A3', 'A4')] == [True, False, True, False, True], r['cards']),
                ('sing-a4: no lean named', not any(UI['result']['offHigh'] in n or UI['result']['offLow'] in n for n in r['notes']), r['notes']),
            ]
            k = cta(run)
            checks.append(('sing-a4: off Android, the Android-only line and no Play button',
                           k['href'] is None and pd['androidOnlyLine'] in k['text'] and UI['result']['ctaBody'] in k['text'], k))
            run.page.click('.tool-panel__state--result button >> text="%s"' % UI['modes']['tuner'])
            run.chip(UI['modes']['sing'])
            checks.append(('sing-a4: the next visit shows last time', idle_text(run).count(COMMON['lastTime'] + ': 0c') == 1,
                           idle_text(run)[-120:]))
            logs += run.logs
            run.close()

            # 2. The same, 20 cents sharp
            run = sing_round(p, origin, sharp, [69, 57, 69, 57, 69], 'sing-sharp', ua=ANDROID, again=True)
            r = run.result
            checks += run.checks
            off = cents_of(r['value'])
            checks += [
                ('sing-sharp: about 20 cents', off is not None and abs(off - 20) <= 2, r['value']),
                ('sing-sharp: most of them were high', any(UI['result']['offHigh'] in n for n in r['notes']), r['notes']),
                ('sing-sharp: none within 10, all within 25', r['facts'].get(UI['result']['within10']) == '0 of 5'
                 and r['facts'].get(UI['result']['within25']) == '5 of 5', r['facts']),
            ]
            k = cta(run)
            checks.append(('sing-sharp: on Android, the tagged Play link', k['href'] == pd['playLink']
                           and 'utm_campaign%3Dsing-in-tune-test' in (k['href'] or ''), k['href']))
            logs += run.logs
            run.close()

            # 3. The free tuner
            run = Run(p, origin, wav=a4, reduced=True)
            run.chip(UI['modes']['tuner'])
            run.start()
            run.page.wait_for_function("document.querySelector('.note-target__name') && "
                                       "document.querySelector('.note-target__name').textContent === 'A4'", timeout=15000)
            run.page.wait_for_timeout(2500)
            readout = run.eval("document.querySelector('.tool-panel__state--run:not([hidden]) .st-readout__main').textContent")
            m = re.match('^(%s)$' % '|'.join(UI['offset'][k].replace('{cents}', r'(\d+) cents?') for k in ('high', 'low')), readout)
            locked = run.eval("document.querySelector('.note-target').classList.contains('note-target--locked')")
            run.shot('tuner')
            checks += [
                ('tuner: A4 within 2 cents', readout == UI['offset']['zero'] or (m is not None and int(m.group(2) or m.group(3)) <= 2), readout),
                ('tuner: the held note locks', locked, locked),
                ('tuner: reduced motion keeps the trail still',
                 run.eval("getComputedStyle(document.querySelector('.pitch-trail')).getPropertyValue('--trail-motion').trim()") == '0', None),
                ('tuner: the dot says the microphone is live',
                 run.eval("!!document.querySelector('.tool-panel__state--run.tool-panel__state--listening')"), None),
            ]
            run.page.click('.tool-panel__state--run button >> text="%s"' % COMMON['stop'])
            run.page.wait_for_selector('.tool-panel__state--idle:not([hidden])')
            checks.append(('tuner: Stop turns the microphone off', not run.eval('window.__probe.live()'), None))
            logs += run.logs
            run.close()

            # 4. Higher or lower: the piano only
            run = Run(p, origin, wav=a4, config={'seed': 11})
            r, focused = ear_by_keyboard(run, 'ear')
            run.shot('ear-result')
            checks += [
                ('ear: three right, by keyboard alone, give 3 of 3', r['value'] == '3 of 3', r['value']),
                ('ear: focus lands on Try again', focused == COMMON['tryAgain'], focused),
                ('ear: no microphone at all', run.eval('window.__probe.gum') == 0, run.eval('window.__probe.gum')),
                ('ear: fits 360 px wide', run.overflow() <= 0, run.overflow()),
            ]
            logs += run.logs
            run.close()

            # 5. The range test's saved range picks the notes; Stop mid-round
            saved = "localStorage.setItem('scalita-range', JSON.stringify({low: 45, high: 76, date: '2026-10-20', source: 'mic'}));"
            run = Run(p, origin, wav=a4, extra_init=saved)
            choice = run.eval("(() => { const s = document.querySelector('select'); return [s.value, s.selectedOptions[0].textContent]; })()")
            run.start()
            run.page.wait_for_function("window.__scalitaTest.events.some((e) => e.kind === 'piano')", timeout=20000)
            first = run.eval("window.__scalitaTest.events.find((e) => e.kind === 'piano').midi")
            run.page.click('.tool-panel__state--run button >> text="%s"' % COMMON['stop'])
            run.page.wait_for_selector('.tool-panel__state--idle:not([hidden])')
            run.page.wait_for_timeout(300)
            silent = (not run.eval('window.__probe.live()')
                      and not run.eval('window.__probe.voices.some((v) => v.c.state !== "closed" && v.c.currentTime < v.to)'))
            # Straight into another round: the piano takes the new context
            run.start()
            run.page.wait_for_function("window.__scalitaTest.events.filter((e) => e.kind === 'piano').length >= 2", timeout=20000)
            again = run.eval("document.querySelector('.tool-panel__state--run:not([hidden]) .tool-panel__status').textContent")
            run.page.click('.tool-panel__state--run button >> text="%s"' % COMMON['stop'])
            checks += [
                ('saved range: chosen by default', choice[0] == 'saved' and 'A2' in choice[1] and 'E5' in choice[1], choice),
                ('saved range: a new round after Stop starts', again == fmt_note(1), again),
                ('saved range: notes from its middle, A2 to E5 gives E3 to A4', 52 <= first <= 69, first),
                ('saved range: Stop silences both', silent, None),
            ]
            logs += run.logs
            run.close()

            # 6. The tab goes to the background mid-round
            run = Run(p, origin, wav=a4, config={'targets': [69, 69, 69, 69, 69]})
            run.start()
            run.page.wait_for_function("window.__scalitaTest.events.filter((e) => e.kind === 'mic').length >= 2", timeout=20000)
            run.page.wait_for_timeout(300)
            run.eval("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });"
                     "document.dispatchEvent(new Event('visibilitychange'))")
            run.page.wait_for_selector('.tool-panel__state--error:not([hidden])', timeout=5000)
            text = run.eval("document.querySelector('.tool-panel__error').textContent")
            run.page.wait_for_timeout(300)
            checks += [
                ('hidden tab: the micHidden string', text == MIC['micHidden'], text),
                ('hidden tab: the microphone is off', not run.eval('window.__probe.live()'), None),
            ]
            logs += run.logs
            run.close()

            # 7. An in-app browser, and refused microphones
            run = Run(p, origin, ua=INSTAGRAM)
            idle = run.eval("document.querySelector('.tool-panel__state--idle').textContent")
            checks.append(('in-app: the open-in-your-browser panel', COMMON['openInBrowser'] in idle
                           and COMMON['copyLink'] in idle, idle[:200]))
            run.chip(UI['modes']['ear'])
            checks.append(('in-app: the listening check still offered',
                           run.eval("!!document.querySelector('.tool-panel__state--idle .btn--fill')"), None))
            run.close()
            for name, code in (('NotFoundError', 'micNotFound'), ('NotAllowedError', 'micBlocked'),
                               ('NotReadableError', 'micBusy')):
                deny = ("navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', '%s'));" % name)
                run = Run(p, origin, extra_init=deny)
                run.start()
                run.page.wait_for_selector('.tool-panel__state--error:not([hidden])', timeout=10000)
                text = run.eval("document.querySelector('.tool-panel__error').textContent")
                checks.append(('refused (%s): the %s string' % (name, code), text == MIC[code], text))
                logs += [x for x in run.logs if 'getUserMedia' not in x]
                run.close()
    finally:
        srv.shutdown()

    checks.append(('console clean', not logs, logs))
    failed = 0
    for name, ok, got in checks:
        print('%s %s%s' % ('ok  ' if ok else 'FAIL', name, '' if ok else ': ' + json.dumps(got, ensure_ascii=False)[:400]))
        failed += not ok
    print('screenshots in', SCRATCH)
    print('PASS' if not failed else 'FAIL (%d)' % failed)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
