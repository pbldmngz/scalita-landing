/*
 * The vocal range test: the lowest comfortable note, then the highest, each
 * locked once held steady (the app's 600 ms rule, pitch.js NoteLock), then
 * a result in the reader's notation. UI only; every word comes from the page
 * data (ui/<loc>/vocal-range-test.json, common.json, mic.json).
 *
 * Before a tap the page loads this file and mic.js. listener.js and pitch.js
 * load on Start, share-card.js with a result, piano.js on the tap that plays.
 * Microphone or piano, never both: the piano waits for the mic's tracks to
 * stop, and Start silences the piano first.
 *
 * mount(el, pageData, {createListener}) returns a handle (also el.rangeTest);
 * each change fires 'rangetest' on el: {state, phase, low, high, micOn}.
 * The last result stays in localStorage 'scalita-range': {low, high, date,
 * source} (MIDI, YYYY-MM-DD, 'mic' or 'manual'). Tests: tool/tests/range-test/.
 */

import { ERRORS, HINTS, checkSupport, inAppBrowser, micIsLive } from '../audio/mic.js';

const TOOL = 'vocal-range-test';
export const STORE = 'scalita-range';
const PICK = [36, 72]; // the picker shows one octave, starting on C2 up to C5
const FLAG_AT = 5; // fry or whistle readings before the result mentions them
const NARROW = 12; // under an octave there is no voice type to compare (the app's rule)
const MIC_HINTS = [HINTS.SILENT, HINTS.LOUD, HINTS.QUIET];

export const fill = (s, v = {}) =>
  String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

// VoiceType.closestForRange (lib/core/models/voice_type.dart): the range's
// midpoint against each type's typical midpoint, VoiceType order on a tie;
// the runner-up is named too when it is within 2 semitones
export function typicalFor(types, low, high) {
  const mid = (low + high) / 2;
  const by = (types || [])
    .map((t, i) => [Math.abs((t.rangeLow + t.rangeHigh) / 2 - mid), i, t])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!by.length) return [];
  return by.length > 1 && by[1][0] - by[0][0] <= 2 ? [by[0][2], by[1][2]] : [by[0][2]];
}

// A major scale up from low, landing on high
export function scaleRun(low, high) {
  const out = [];
  for (let m = low, i = 0; m < high; m += [2, 2, 1, 2, 2, 2, 1][i++ % 7]) out.push(m);
  out.push(high);
  return out;
}

const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

/*
 * The test's phases over a lock (pitch.js NoteLock), timed by the readings'
 * own clock, as range_detect_screen.dart times them:
 *   low -> shown (1.5 s, the note on screen) -> breath (2 s) -> high -> done
 * The highest note must be above the lowest: a reading at or under it breaks
 * a note. Fry and whistle readings (pitch.js flags them) neither count nor
 * break one; they are tallied for the result. hint is a ui key while one
 * applies.
 */
export class RangeSession {
  constructor(lock, { showSec = 1.5, breathSec = 2 } = {}) {
    Object.assign(this, { lock, showSec, breathSec });
    this.low = this.high = this.at = this.t = null;
    this.fry = this.whistle = 0;
    this.go('low', null);
  }

  go(phase, t) {
    this.phase = phase;
    this.at = t;
    this.recent = [];
    this.below = this.voiced = 0;
    this.hint = null;
  }

  // True when the phase changed
  push(r) {
    const was = this.phase;
    if (was === 'done') return false;
    const dt = this.t === null ? 0 : Math.min(Math.max(r.t - this.t, 0), 0.25);
    this.t = r.t;
    if (this.at === null) this.at = r.t;
    let kind = r.fry ? 'f' : r.whistle && r.rawHz !== null ? 'w' : '';
    if (kind === 'f') this.fry++;
    if (kind === 'w') this.whistle++;
    if (was === 'shown' && r.t - this.at >= this.showSec) this.go('breath', r.t);
    else if (was === 'breath' && r.t - this.at >= this.breathSec) {
      this.go('high', r.t);
      this.lock.reset();
    }
    const p = this.phase;
    if (p === 'low' || p === 'high') {
      let x = r;
      if (kind === 'w') x = { ...r, outside: true };
      else if (p === 'high' && r.midi !== null && r.midi <= this.low) {
        x = { ...r, stable: false };
        kind = 'b';
      }
      this.below = kind === 'b' ? this.below + 1 : r.midi !== null ? 0 : this.below;
      if (r.hz !== null) this.voiced += dt;
      const m = this.lock.push(x);
      if (m !== null) {
        if (p === 'low') {
          this.low = m;
          this.go('shown', r.t);
        } else {
          this.high = m;
          this.go('done', r.t);
        }
        return true;
      }
      this.recent.push(kind);
      if (this.recent.length > 8) this.recent.shift();
      const n = (k) => this.recent.filter((y) => y === k).length;
      this.hint = p === 'low' && n('f') >= 3 ? 'fryHint'
        : p === 'high' && n('w') >= 3 ? 'whistleHint'
          : p === 'high' && this.below >= 15 ? 'aboveLowHint'
            : this.voiced >= 4 ? 'holdSteady' : null;
    }
    return this.phase !== was;
  }
}

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(2)) if (c != null && c !== false) e.append(c);
  return e;
}

// Holds a line that changes words at its widest and tallest: full width (a
// centred box as wide as its text moves when the text does) and the height
// of the longest thing it will say, in this language at this width
function reserve(el, texts, wide = true) {
  if (wide) el.style.width = '100%';
  const keep = el.textContent;
  let most = 0;
  for (const t of texts) {
    el.textContent = t;
    most = Math.max(most, el.offsetHeight);
  }
  el.textContent = keep;
  el.style.minHeight = most + 'px';
}

// Writes only a change, so a line read 20 times a second is left alone
const setText = (el, t) => {
  if (el.textContent !== t) el.textContent = t;
};

// replaceChildren would print false and null: leave them out
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((c) => c != null && c !== false && c !== ''));

function readLast() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    if (v && Number.isInteger(v.low) && Number.isInteger(v.high) && v.low < v.high) return v;
  } catch {}
  return null;
}

function writeLast(v) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {}
}

let engine = null;
function loadEngine() {
  if (!engine) {
    engine = Promise.all([import('../audio/listener.js'), import('../audio/pitch.js')])
      .then(([l, p]) => ({ ...p, createListener: l.createListener, prepare: l.prepare }))
      .catch((e) => {
        engine = null;
        throw e;
      });
  }
  return engine;
}

const newContext = () => {
  const A = globalThis.AudioContext || globalThis.webkitAudioContext;
  return new A({ latencyHint: 'interactive' });
};

const resume = (c) => {
  try {
    const p = c.resume();
    if (p && p.catch) p.catch(() => {});
  } catch {}
};

// The pitch trail: the last 4 s, 14 semitones tall around the voice, a line
// on each note. At --trail-motion 0 only the current pitch shows, still.
function draw(cv, pts, col, motion, center, lockedAt) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const w = Math.round(cv.clientWidth * dpr), ht = Math.round(cv.clientHeight * dpr);
  if (!w || !ht) return center;
  if (cv.width !== w || cv.height !== ht) {
    cv.width = w;
    cv.height = ht;
  }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, ht);
  const now = pts.length ? pts[pts.length - 1][0] : 0;
  const vis = pts.filter((p) => p[1] !== null && now - p[0] <= 4);
  const want = lockedAt != null ? lockedAt : vis.length ? median(vis.slice(-10).map((p) => p[1])) : null;
  if (want != null) center = center == null ? want : center + (want - center) * 0.08;
  if (center == null) return center;
  const y = (m) => ht / 2 - ((m - center) * ht) / 14;
  g.fillStyle = col.grid;
  for (let m = Math.ceil(center - 7); m <= center + 7; m++) g.fillRect(0, Math.round(y(m)), w, dpr);
  if (lockedAt != null) {
    g.fillStyle = col.target;
    g.fillRect(0, y(lockedAt + 0.5), w, ht / 14);
  }
  g.lineWidth = 3 * dpr;
  g.lineCap = 'round';
  const last = vis[vis.length - 1];
  if (!motion) {
    if (last && now - last[0] < 0.3) {
      g.fillStyle = last[2] ? col.perfect : col.travel;
      g.beginPath();
      g.arc(w - 12 * dpr, y(last[1]), 6 * dpr, 0, 7);
      g.fill();
    }
    return center;
  }
  const x = (t) => w - ((now - t) / 4) * w;
  for (let i = 1; i < vis.length; i++) {
    const a = vis[i - 1], b = vis[i];
    if (b[0] - a[0] > 0.12) continue;
    g.strokeStyle = a[2] && b[2] ? col.perfect : col.travel;
    g.beginPath();
    g.moveTo(x(a[0]), y(a[1]));
    g.lineTo(x(b[0]), y(b[1]));
    g.stroke();
  }
  return center;
}

export function mount(el, data = {}, hooks = {}) {
  if (el.rangeTest) return el.rangeTest;
  const S = data.strings || {};
  const U = S[TOOL] || {}, C = S.common || {}, M = S.mic || {};
  const T = (k, v) => fill(U[k], v);
  const notes = data.notes || {};
  const local = (m) => (notes[m] ? notes[m][0] : String(m));
  const intl = (m) => (notes[m] ? notes[m][1] : String(m));
  const named = (m) => (local(m) === intl(m) ? local(m) : local(m) + ' (' + intl(m) + ')');
  const span = (a, b, f = named) => T('rangeValue', { low: f(a), high: f(b) });
  const lang = data.lang || data.locale || 'en';
  const num = (x) => {
    try {
      return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);
    } catch {
      return x.toFixed(1);
    }
  };
  const day = (iso) => {
    try {
      const d = new Date(iso + 'T12:00:00');
      const o = { day: 'numeric', month: 'short' };
      if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
      return new Intl.DateTimeFormat(lang, o).format(d);
    } catch {
      return iso;
    }
  };
  const nav = globalThis.navigator || {};
  const ua = nav.userAgent || '';
  const platform = /Android/i.test(ua) ? 'android'
    : /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) ? 'ios' : 'desktop';
  const wr = (data.registers || []).find((r) => r.id === 'whistle');
  const whistleFrom = wr ? wr.low : 89;
  const manifest = data.piano && data.piano.manifest;

  let state = null, run = 0, listener = null, mctx = null, sess = null, E = null, raf = 0;
  let view = null, trail = [], settings = null, micOn = false;
  let piano = null, pianoP = null, pctx = null, playing = null;
  let last = readLast();
  const pk = { low: null, high: null, step: 'low', win: 48 };

  el.classList.add('tool-panel');
  el.replaceChildren();
  const panes = {};
  for (const k of ['idle', 'listening', 'result', 'error', 'manual']) {
    panes[k] = h('div', { class: 'tool-panel__state tool-panel__state--' + k, hidden: true });
    el.append(panes[k]);
  }
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  el.append(live);

  const say = (text) => {
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 80);
  };
  const emit = () => el.dispatchEvent(new CustomEvent('rangetest', {
    detail: { state, phase: sess && sess.phase, low: sess && sess.low, high: sess && sess.high, micOn },
  }));
  function show(k, focus) {
    for (const p in panes) panes[p].hidden = p !== k;
    state = k;
    el.dataset.state = k;
    const f = focus && panes[k].querySelector('[data-focus]');
    if (f) f.focus();
    emit();
  }
  const btn = (label, cls, onclick, extra) => h('button', { type: 'button', class: cls, onclick, ...extra }, label);
  const title = (text) => h('h3', { 'data-focus': '', tabindex: '-1' }, text);
  const note = (text) => text && h('p', { class: 'result-card__note' }, text);

  function canonical() {
    const c = document.querySelector('link[rel="canonical"]');
    return (c && c.href) || location.href.split('#')[0];
  }

  function copyBtn() {
    const b = btn(C.copyLink, 'btn btn-secondary', () => {
      const url = canonical();
      const shown = () => {
        const i = h('input', { value: url, readonly: true, 'aria-label': C.copyLink, size: 28 });
        b.replaceWith(i);
        i.select();
      };
      try {
        navigator.clipboard.writeText(url).then(() => {
          b.textContent = C.copied;
          say(C.copied);
        }, shown);
      } catch {
        shown();
      }
    });
    return b;
  }

  const pickBtn = () => btn(T('noMic'), 'btn btn-secondary', () => {
    if (pk.low === null && last) Object.assign(pk, { low: last.low, high: last.high });
    pk.step = 'low';
    pk.win = winOf(pk.low === null ? 48 : pk.low);
    picker(true);
  });

  function idle(focus) {
    stopMic();
    stopPiano();
    sess = null;
    const app = inAppBrowser(ua);
    const code = app ? null : checkSupport();
    if (code) return fail(code, focus);
    const k = [];
    if (app) {
      k.push(h('p', { 'data-focus': '', tabindex: '-1' }, C.openInBrowser),
        h('div', { class: 'tool-panel__actions' }, copyBtn(), pickBtn()),
        btn(T('tryAnyway'), 'btn btn-secondary', start));
    } else {
      const go = btn(C.start, 'btn btn-primary', start);
      const early = () => loadEngine().catch(() => {});
      for (const ev of ['pointerdown', 'keydown', 'focus']) go.addEventListener(ev, early, { once: true });
      k.push(title(T('title')), h('p', null, T('intro')), go, h('p', { class: 'tool-panel__hint' }, C.allow),
        pickBtn(), note(C.privacyLine));
    }
    if (last) k.push(note(T('lastTimeLine', { range: span(last.low, last.high) })));
    put(panes.idle, k);
    show('idle', focus);
  }

  function start() {
    const code = checkSupport();
    if (code) return fail(code, true);
    stopMic();
    stopPiano();
    const my = ++run;
    let ctx;
    try {
      // Inside the tap: the context first, resumed, then the microphone
      ctx = mctx = newContext();
      resume(ctx);
    } catch {
      return fail(ERRORS.FAILED, true);
    }
    // Faces the listening view needs, fetched now: nothing loads while the mic is live
    if (document.fonts) {
      const family = getComputedStyle(el).fontFamily;
      for (const w of [300, 400, 500]) document.fonts.load(w + ' 1em ' + family).catch(() => {});
    }
    listening();
    loadEngine().then(async (e) => {
      // the capture worklet too, before the microphone opens
      if (my === run && e.prepare) await e.prepare(ctx);
      if (my !== run) return;
      E = e;
      sess = new RangeSession(new E.NoteLock());
      listener = (hooks.createListener || E.createListener)({
        context: ctx,
        whistleFromMidi: whistleFrom,
        onReading: (r) => my === run && reading(r),
        onError: (c) => my === run && fail(c, true),
        onHint: (c, on) => my === run && micHint(c, on),
        onState: (s) => my === run && s === 'listening' && heard(),
      });
      return listener.start();
    }).catch(() => my === run && fail(ERRORS.FAILED, true));
  }

  function listening() {
    const v = (view = { hints: new Set() });
    v.status = h('p', { class: 'tool-panel__status' }, C.allow);
    v.title = title(T('singLow'));
    v.help = note(T('singLowHelp'));
    v.name = h('span', { class: 'note-target__name' });
    v.intl = h('span', { class: 'note-target__intl' });
    v.target = h('div', { class: 'note-target', 'aria-hidden': 'true' }, v.name, v.intl);
    v.canvas = h('canvas', { 'aria-hidden': 'true' });
    v.trail = h('div', { class: 'pitch-trail' }, v.canvas);
    v.fill = h('span', { class: 'level-meter__fill' });
    v.meter = h('div', { class: 'level-meter', 'aria-hidden': 'true' }, v.fill, h('span', { class: 'level-meter__gate' }));
    v.hint = h('p', { class: 'tool-panel__hint', 'aria-live': 'polite' });
    v.actions = h('div', { class: 'tool-panel__actions' }, btn(C.stop, 'btn btn-secondary', stop));
    trail = [];
    panes.listening.classList.remove('tool-panel__state--listening');
    put(panes.listening, v.status, v.title, v.help, v.target, v.trail, v.meter, v.hint, v.actions);
    show('listening', true);
    const long = named(61);
    reserve(v.status, [C.allow, T('stepLow'), T('stepHigh'), T('micOff')], false);
    reserve(v.title, [T('singLow'), T('singHigh'), T('nowHigh'), T('lockedLow', { note: long }), T('lockedHigh', { note: long })]);
    reserve(v.help, [T('singLowHelp'), T('singHighHelp')]);
    reserve(v.hint, [...MIC_HINTS, HINTS.BLUETOOTH].map((c) => M[c]).concat(T('fryHint'), T('holdSteady'),
      T('whistleHint', { note: named(whistleFrom) }), T('aboveLowHint', { note: long })));
  }

  // The tracks are live: from here until stopMic nothing is fetched
  function heard() {
    micOn = true;
    settings = listener.settings;
    panes.listening.classList.add('tool-panel__state--listening');
    phaseView();
    loop();
  }

  function reading(r) {
    const changed = sess.push(r);
    trail.push([r.t, r.hz === null ? null : r.midi + r.cents / 100, r.stable]);
    if (trail.length > 120) trail.shift();
    Object.assign(view, { level: E.meterLevel(r.rms), ok: !r.gated, loud: r.peak >= 0.99 });
    if (changed) phaseView();
    else if (r.hz !== null && (sess.phase === 'low' || sess.phase === 'high')) target(r.midi, false);
    hintView();
  }

  function target(m, locked) {
    setText(view.name, m == null ? '' : local(m));
    setText(view.intl, m == null || local(m) === intl(m) ? '' : intl(m));
    view.target.classList.toggle('note-target--locked', locked);
  }

  function phaseView() {
    const p = sess.phase, v = view;
    if (p === 'low' || p === 'high') {
      const low = p === 'low';
      setText(v.status, T(low ? 'stepLow' : 'stepHigh'));
      setText(v.title, T(low ? 'singLow' : 'singHigh'));
      setText(v.help, T(low ? 'singLowHelp' : 'singHighHelp'));
      target(null, false);
      say(v.title.textContent);
    } else if (p === 'shown') {
      setText(v.title, T('lockedLow', { note: named(sess.low) }));
      target(sess.low, true);
      say(v.title.textContent);
    } else if (p === 'breath') {
      setText(v.title, T('nowHigh'));
      setText(v.help, T('singHighHelp'));
      target(null, false);
    } else if (p === 'done') {
      done();
    }
    emit();
  }

  function done() {
    const s = sess, v = view;
    setText(v.title, T('lockedHigh', { note: named(s.high) }));
    target(s.high, true);
    stopMic();
    panes.listening.classList.remove('tool-panel__state--listening');
    setText(v.status, T('micOff'));
    setText(v.help, '');
    setText(v.hint, '');
    const see = btn(T('seeResult'), 'btn btn-primary', () => result({
      low: s.low, high: s.high, source: 'mic', fry: s.fry >= FLAG_AT, whistle: s.whistle >= FLAG_AT,
    }, true));
    v.actions.replaceChildren(see);
    see.focus();
    say(v.title.textContent + ' ' + T('micOff'));
  }

  function micHint(code, on) {
    if (on) view.hints.add(code);
    else view.hints.delete(code);
    hintView();
  }

  function hintView() {
    const v = view, mic = MIC_HINTS.find((c) => v.hints.has(c));
    const k = sess && sess.hint;
    // The headset notice is the least urgent: it stays true all session
    const text = mic ? M[mic]
      : k ? T(k, { note: named(k === 'whistleHint' ? whistleFrom : k === 'aboveLowHint' ? sess.low : 60) })
        : v.hints.has(HINTS.BLUETOOTH) ? M[HINTS.BLUETOOTH] : '';
    setText(v.hint, text);
  }

  function loop() {
    const v = view;
    const css = getComputedStyle(v.trail);
    const col = (n, f) => css.getPropertyValue(n).trim() || f;
    const colors = {
      perfect: col('--trail-perfect', '#8AC4C7'), travel: col('--trail-travel', '#A8B5BA'),
      grid: col('--trail-grid', 'rgba(58, 69, 72, 0.7)'), target: col('--trail-target', 'rgba(90, 159, 163, 0.12)'),
    };
    const motion = col('--trail-motion', '1') !== '0';
    v.meter.style.setProperty('--gate', E.GATE_LEVEL);
    let center = null;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      v.meter.style.setProperty('--level', v.level || 0);
      v.meter.classList.toggle('level-meter--ok', !!v.ok);
      v.meter.classList.toggle('level-meter--loud', !!v.loud);
      const p = sess && sess.phase;
      center = draw(v.canvas, trail, colors, motion, center, p === 'shown' ? sess.low : p === 'done' ? sess.high : null);
    };
    cancelAnimationFrame(raf);
    frame();
  }

  // Stops the tracks now; resolves once the context is closed too
  function stopMic() {
    run++;
    cancelAnimationFrame(raf);
    raf = 0;
    const l = listener, c = mctx;
    listener = mctx = null;
    if (micOn) {
      micOn = false;
      emit();
    }
    return Promise.resolve(l && l.stop())
      .catch(() => {})
      .then(() => c && c.state !== 'closed' && c.close().catch(() => {}));
  }

  function stop() {
    idle(true);
    say(T('stopped'));
  }

  function fail(code, focus) {
    stopMic();
    sess = null;
    const msg = M[code] || M[ERRORS.FAILED];
    const again = code !== ERRORS.UNSUPPORTED && code !== ERRORS.IN_APP;
    put(panes.error,
      h('p', { class: 'tool-panel__error', role: 'alert', 'data-focus': '', tabindex: '-1', 'data-code': code }, msg),
      h('div', { class: 'tool-panel__actions' },
        again && btn(C.tryAgain, 'btn btn-secondary', start),
        code === ERRORS.IN_APP && copyBtn(),
        pickBtn()));
    show('error', focus);
  }

  // Keys from a to b, white at both ends: buttons when tap is given
  function keyboard(a, b, mark, tap) {
    let whites = 0;
    const kids = [];
    for (let m = a; m <= b; m++) {
      const black = isBlack(m);
      if (!black) whites++;
      const k = mark(m);
      const cls = 'key' + (black ? ' key--black' : '') + k.cls;
      kids.push(tap
        ? btn(black ? '' : local(m), cls, () => tap(m), {
          'aria-label': named(m), 'aria-pressed': String(!!k.pressed), disabled: k.disabled, 'data-midi': m,
        })
        : h('span', { class: cls, 'data-midi': m }));
    }
    return h('div', { class: 'keyboard', style: '--whites: ' + whites + (tap ? '; --keys-height: 140px' : '') }, kids);
  }

  const winOf = (m) => Math.min(PICK[1], Math.max(PICK[0], m - (((m % 12) + 12) % 12)));

  function arrows(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const keys = [...e.currentTarget.querySelectorAll('button:not([disabled])')];
    const next = keys[keys.indexOf(document.activeElement) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) {
      next.focus();
      e.preventDefault();
    }
  }

  // The no-microphone path: the lowest note, then the highest, by hand. A
  // key plays when tapped, so a singer can try each one.
  function picker(focus, refocus) {
    stopMic();
    sess = null;
    const lowStep = pk.step === 'low';
    const chosen = lowStep ? pk.low : pk.high;
    const kb = keyboard(pk.win, pk.win + 12, (m) => ({
      cls: (m === chosen ? ' key--active' : '')
        + (!lowStep && chosen !== null && m >= pk.low && m <= chosen ? ' key--range' : ''),
      pressed: m === chosen,
      disabled: !lowStep && m <= pk.low,
    }), (m) => {
      sound(m);
      pk[pk.step] = m;
      picker(false, '[data-midi="' + m + '"]');
    });
    kb.setAttribute('role', 'group');
    kb.setAttribute('aria-label', T('keysLabel', { low: named(pk.win), high: named(pk.win + 12) }));
    kb.addEventListener('keydown', arrows);
    const shift = (d, key) => () => {
      pk.win += d;
      picker(false, '[data-shift="' + key + '"]');
    };
    const chips = h('div', { class: 'chips' },
      btn(T('lowerKeys'), 'chip', shift(-12, 'down'), { disabled: pk.win <= PICK[0], 'data-shift': 'down' }),
      btn(T('higherKeys'), 'chip', shift(12, 'up'), { disabled: pk.win >= PICK[1], 'data-shift': 'up' }));
    const next = lowStep
      ? btn(C.next, 'btn btn-primary', () => {
        pk.step = 'high';
        if (pk.high !== null && pk.high <= pk.low) pk.high = null;
        pk.win = winOf(pk.high !== null ? pk.high : pk.low + 19);
        picker(true);
      }, { disabled: pk.low === null })
      : btn(T('showRange'), 'btn btn-primary', () => result({ low: pk.low, high: pk.high, source: 'manual' }, true),
        { disabled: pk.high === null });
    const back = btn(C.back, 'btn btn-secondary', () => {
      if (lowStep) return idle(true);
      pk.step = 'low';
      pk.win = winOf(pk.low);
      picker(true);
    });
    put(panes.manual,
      h('p', { class: 'tool-panel__status' }, T('manualTitle')),
      title(T(lowStep ? 'manualLow' : 'manualHigh')),
      kb, chips,
      pk.low !== null && note(T('chosenLow', { note: named(pk.low) })),
      !lowStep && pk.high !== null && note(T('chosenHigh', { note: named(pk.high) })),
      h('div', { class: 'tool-panel__actions' }, back, next));
    show('manual', focus);
    const f = refocus && panes.manual.querySelector(refocus);
    if (f && !f.disabled) f.focus();
  }

  function result(res, focus) {
    stopMic();
    stopPiano();
    sess = null;
    const { low, high } = res;
    const before = last;
    last = { low, high, date: new Date().toISOString().slice(0, 10), source: res.source };
    writeLast(last);
    const n = high - low, oct = n / 12, narrow = n < NARROW;
    // The language's own plural rule, on the number as shown: French and
    // Portuguese keep 1,8 singular, English says 1.0 octaves
    const one = (x, digits) => {
      try {
        return new Intl.PluralRules(lang, digits ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : {}).select(x) === 'one';
      } catch {
        return x === 1;
      }
    };
    const semis = T(one(n) ? 'semitoneOne' : 'semitoneMany', { n });
    const octs = T(one(oct, true) ? 'octaveOne' : 'octaveMany', { n: num(oct) });
    const types = narrow ? [] : typicalFor(data.voiceTypes, low, high);
    const typical = types.length === 2 ? T('typicalTwo', { first: types[0].name, second: types[1].name })
      : types.length ? types[0].name : '';
    const text = span(low, high);
    const fact = (dt, dd) => h('div', null, h('dt', null, dt), h('dd', null, dd));
    const pair = local(low) !== intl(low) || local(high) !== intl(high);
    const card = h('div', { class: 'result-card' },
      h('p', { class: 'result-card__label' }, T('resultLabel')),
      h('p', { class: 'result-card__value', 'data-focus': '', tabindex: '-1' },
        span(low, high, local), pair && [' ', h('small', null, span(low, high, intl))]),
      h('dl', { class: 'result-card__facts' },
        fact(T('spanLabel'), narrow ? semis : T('spanValue', { semitones: semis, octaves: octs })),
        typical && fact(T('typicalLabel'), typical),
        before && fact(C.lastTime, T('lastTimeValue', { range: span(before.low, before.high), date: day(before.date) }))),
      note(narrow ? T('tooNarrow') : T('mayChange')),
      !narrow && note(T('breakMoreReliable')),
      res.fry && note(T('fryFlag', { note: named(36) })),
      res.whistle && note(T('whistleFlag', { note: named(whistleFrom) })),
      res.source === 'manual' && note(T('manualNote')));

    // The share card: drawn here, on the device, once this module arrives
    const big = narrow ? semis : octs;
    const canvas = h('canvas', { width: 1080, height: 1920, role: 'img',
      'aria-label': [T('shareTitle'), text, big, typical].filter(Boolean).join('. ') });
    const shareB = nav.share && btn(C.share, 'btn btn-secondary', null, { disabled: true });
    const saveB = btn(C.save, 'btn btn-secondary', null, { disabled: true });
    const from = Math.max(21, low - (isBlack(low - 1) ? 2 : 1)), to = Math.min(108, high + (isBlack(high + 1) ? 2 : 1));
    import('./share-card.js').then(async (m) => {
      await m.drawCard(canvas, {
        kicker: T('shareTitle'), title: span(low, high, local), sub: pair ? span(low, high, intl) : '',
        big, lines: [typical && T('typicalLine', { types: typical })], keys: { from, to, low, high },
        site: new URL(canonical()).host, footer: T('shareFooter'),
      });
      const file = await m.toFile(canvas, T('shareFileName') + '.png');
      if (!file) return;
      const url = canonical();
      if (shareB) {
        shareB.disabled = false;
        shareB.addEventListener('click', () => m.share(file, { title: T('shareTitle'), text: T('shareText', { range: text }) + ' ' + url, url }));
      }
      saveB.disabled = false;
      saveB.addEventListener('click', () => {
        m.save(file);
        say(T('saved'));
      });
    }, () => {
      for (const b of [shareB, saveB]) if (b) b.hidden = true;
    });

    const cta = h('div', { class: 'callout' },
      h('p', null, T(platform === 'android' ? 'ctaAndroid' : platform === 'ios' ? 'ctaIos' : 'ctaDesktop', { range: text })),
      platform === 'android' && data.playLink && h('p', null, h('a', { class: 'btn btn-primary', href: data.playLink }, T('ctaButton'))),
      platform === 'desktop' && h('p', null, copyBtn()));

    const kb = keyboard(from, to, (m) => ({ cls: m >= low && m <= high ? ' key--range' : '' }));
    kb.setAttribute('role', 'img');
    kb.setAttribute('aria-label', T('keyboardRange', { range: text }));
    const pianoS = manifest && h('p', { class: 'result-card__note', 'aria-live': 'polite', style: 'min-height: 3.2em' });
    const pianoB = manifest && btn(T('pianoButton'), 'piano-button', () => playRange(low, high, pianoB, kb, pianoS),
      { 'aria-pressed': 'false' });
    const brk = data.links && data.links['voice-break-finder'];
    put(panes.result, card,
      h('div', { class: 'share-card' }, canvas, h('div', { class: 'share-card__actions' }, shareB, saveB)),
      cta, kb,
      h('div', { class: 'tool-panel__actions' }, pianoB, brk && h('a', { class: 'piano-button', href: brk }, T('breakButton'))),
      pianoS,
      h('div', { class: 'tool-panel__actions' }, btn(C.tryAgain, 'btn btn-secondary', () => idle(true))));
    show('result', focus);
    say(T('resultLabel') + ': ' + text);
  }

  // The piano. Its context is made inside the tap that needs it; the mic's
  // tracks are stopped before a note is scheduled.
  function pianoCtx() {
    if (!pctx || pctx.state === 'closed') {
      pctx = newContext();
      // iOS lets a context sound only once something played inside the tap
      const s = pctx.createBufferSource();
      s.buffer = pctx.createBuffer(1, 1, pctx.sampleRate);
      s.connect(pctx.destination);
      s.start(0);
    }
    resume(pctx);
    return pctx;
  }

  function pianoReady() {
    if (!pianoP) {
      pianoP = import('../audio/piano.js').then((p) => {
        p.init(manifest, (data.piano && data.piano.base) || undefined);
        return (piano = p);
      }, () => (pianoP = null));
    }
    return (micIsLive() ? stopMic() : Promise.resolve()).then(() => pianoP).then((p) => {
      if (p && pctx) p.useContext(pctx);
      return p;
    });
  }

  function sound(m) {
    if (!manifest) return;
    try {
      pianoCtx();
    } catch {
      return;
    }
    pianoReady().then((p) => p && !micIsLive() && p.playNote(m));
  }

  function stopPlaying(cut) {
    const my = playing;
    if (!my) return;
    playing = null;
    cancelAnimationFrame(my.raf);
    if (cut && piano) piano.stopAll();
    my.reset();
  }

  function stopPiano() {
    stopPlaying(true);
    if (piano) piano.release();
    if (pctx && pctx.state !== 'closed') pctx.close().catch(() => {});
    pctx = null;
  }

  // Lowest note, highest note, then a scale between them, the keys lit. The
  // button keeps its words (a new width would move the page); a second tap stops.
  function playRange(low, high, b, kb, status) {
    if (playing) return stopPlaying(true);
    let c;
    try {
      c = pianoCtx();
    } catch {
      return;
    }
    const keys = kb.querySelectorAll('[data-midi]');
    const my = (playing = {
      reset: () => {
        b.setAttribute('aria-pressed', 'false');
        setText(status, '');
        for (const k of keys) k.classList.remove('key--active');
      },
    });
    b.setAttribute('aria-pressed', 'true');
    setText(status, C.loading);
    pianoReady().then(async (p) => {
      if (playing !== my) return;
      if (!p) return stopPlaying(false);
      await p.prepareRange(low, high, { margin: 0 });
      if (playing !== my) return;
      if (micIsLive()) return stopPlaying(true);
      const seq = [[low, 0, 1400], [high, 1500, 1400]];
      const steps = scaleRun(low, high);
      steps.forEach((m, i) => seq.push([m, 3200 + i * 320, i === steps.length - 1 ? 1600 : 320]));
      const t0 = c.currentTime + 0.1;
      for (const [m, at, len] of seq) {
        const [ringMs, fadeMs] = p.ringForNote(len);
        p.playNote(m, { when: t0 + at / 1000, ringMs, fadeMs });
      }
      const end = seq[seq.length - 1][1] + seq[seq.length - 1][2];
      setText(status, T('pianoPlaying'));
      const tick = () => {
        if (playing !== my) return;
        const now = (c.currentTime - t0) * 1000;
        const on = new Set(seq.filter(([, at, len]) => now >= at && now < at + len).map((s) => s[0]));
        for (const k of keys) k.classList.toggle('key--active', on.has(+k.dataset.midi));
        if (now > end) return stopPlaying(false);
        my.raf = requestAnimationFrame(tick);
      };
      tick();
    });
  }

  const api = {
    get state() { return state; },
    get phase() { return sess && sess.phase; },
    get settings() { return settings; },
    get micOn() { return micOn; },
    get last() { return last; },
    get playing() { return !!playing; },
    micLive: () => micIsLive(),
    start,
    stop,
  };
  el.rangeTest = api;
  idle(false);
  return api;
}

function boot() {
  const els = document.querySelectorAll('[data-tool="' + TOOL + '"]');
  if (!els.length) return;
  let data = {};
  try {
    data = JSON.parse(document.getElementById('page-data').textContent);
  } catch {}
  for (const el of els) mount(el, data);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
