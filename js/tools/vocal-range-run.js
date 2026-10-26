/*
 * The vocal range test after the first tap: the two phases over the app's
 * lock (pitch.js NoteLock, 600 ms), the listening view and its pitch trail,
 * the keyboard picker, the result, the piano and the share image.
 * vocal-range-test.js loads it and hands each mount to attach(X), which
 * returns that mount's steps; every word comes from the page data, through X.
 * Microphone or piano, never both.
 */

import { ERRORS, HINTS, micIsLive } from '../audio/mic.js';
import { fill, STORE, ICON, icon, h, put, setText, newContext, resume } from './vocal-range-test.js';

export { fill, STORE };

const FLAG_AT = 5; // fry or whistle readings before the result mentions them
const NARROW = 12; // under an octave there is no voice type to compare (the app's rule)
const WIDE = 36; // three octaves or more hold several types whole: none is named
const MIC_HINTS = [HINTS.SILENT, HINTS.LOUD, HINTS.QUIET];
const PICK = [36, 72]; // the picker shows one octave, starting on C2 up to C5

// More of the site's icons, as path data
const I = {
  stop: ['M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
  play: ['M7 4.5v15l12.5-7.5z'],
  image: [ICON.keys[0], 'M7 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M21 16l-5-5-8 8'],
  share: ['M12 3v12', 'M8 7l4-4 4 4', 'M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'],
  redo: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  clock: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 7v5l3 2'],
  break: ['M3 20h5v-5h4v-5h4V5h5'],
  info: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5', 'M12 17h.01'],
  iphone: ['M8.5 2h7A2.5 2.5 0 0 1 18 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 19.5v-15A2.5 2.5 0 0 1 8.5 2z', 'M11 18h2'],
};

// VoiceType.rangeNamesAType: a type is named for a span of 12 to 35 semitones
export const namesAType = (low, high) => high - low >= NARROW && high - low < WIDE;

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

// The voice types a range holds whole (the app's ranges, pageData.voiceTypes),
// by their low note: what a range of three octaves or more is said to hold
export const typesIn = (types, low, high) => (types || [])
  .filter((t) => low <= t.rangeLow && high >= t.rangeHigh).sort((a, b) => a.rangeLow - b.rangeLow);

const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const round1 = (x) => Math.round(x * 10) / 10;

// The result's keys: from the C below the lowest note to the B above the
// highest, or a white key past each end when that would be more than four
// octaves of keys
export function keyWindow(low, high) {
  const c = (m) => m - (((m % 12) + 12) % 12);
  let a = Math.max(21, c(low - 1)), b = Math.min(108, c(high + 1) + 11), whites = 0;
  for (let m = a; m <= b; m++) whites += !isBlack(m);
  if (whites > 29) {
    a = Math.max(21, low - (isBlack(low - 1) ? 2 : 1));
    b = Math.min(108, high + (isBlack(high + 1) ? 2 : 1));
  }
  return [a, b];
}

// The voice landing on a note: its cents around midi over the voiced run
// that ends at the lock (1.5 s at most), resampled to n points; null when
// too little of it was heard. pts are the trail's [t, midi + cents / 100]
export function contour(pts, midi, end, sec = 1.5, n = 153) {
  const p = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const [t, v] = pts[i];
    if (t > end + 1e-6) continue;
    if (v === null || end - t > sec || (p.length && p[0][0] - t > 0.25)) break;
    p.unshift([t, v]);
  }
  if (p.length < 8) return null;
  const a = p[0][0], d = (end - a) / (n - 1), out = [];
  for (let i = 0, j = 0; i < n; i++) {
    const t = a + d * i;
    while (j < p.length - 2 && p[j + 1][0] < t) j++;
    const [t0, v0] = p[j], [t1, v1] = p[j + 1] || p[j];
    const v = t >= t1 ? v1 : t <= t0 ? v0 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    out.push(round1((v - midi) * 100));
  }
  return out;
}

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

// Holds an element that changes words at its tallest (or widest), measured
// for everything it will say, in this language at this width
function reserve(el, texts, prop = 'minHeight', at = el) {
  const keep = at.textContent;
  let most = 0;
  for (const t of texts) {
    at.textContent = t;
    most = Math.max(most, prop === 'minHeight' ? el.offsetHeight : el.offsetWidth);
  }
  at.textContent = keep;
  el.style[prop] = most + 'px';
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

// The pitch trail: the last 4 s on 14 lanes, one a semitone, around the
// voice (the centre eases toward the median of the last ten readings); each
// lane named at the right, the lane of a held or locked note lit. At
// --trail-motion 0 only the current pitch shows, still.
function draw(cv, pts, col, motion, st) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const w = Math.round(cv.clientWidth * dpr), ht = Math.round(cv.clientHeight * dpr);
  if (!w || !ht) return;
  if (cv.width !== w || cv.height !== ht) {
    cv.width = w;
    cv.height = ht;
  }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, ht);
  const now = pts.length ? pts[pts.length - 1][0] : 0;
  const vis = pts.filter((p) => p[1] !== null && now - p[0] <= 4);
  const want = st.lane != null ? st.lane : vis.length ? median(vis.slice(-10).map((p) => p[1])) : null;
  if (want != null) st.center = st.center == null ? want : st.center + (want - st.center) * 0.08;
  // 14 lanes, fewer on a short trail (a phone's) so each stays readable
  const n = ht / dpr >= 250 ? 14 : Math.max(7, Math.round(ht / dpr / 15));
  const c = st.center, rh = ht / n, y = (m) => ht / 2 - (m - c) * rh;
  const lw = w - Math.min(56 * dpr, w / 4), head = lw - Math.min(48 * dpr, lw / 6);
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let m = Math.floor(c - n / 2 - 0.5); m <= Math.ceil(c + n / 2 + 0.5); m++) {
    const on = m === st.lane;
    g.fillStyle = on ? col.lit : col.lane;
    g.beginPath();
    if (g.roundRect) g.roundRect(0, y(m + 0.5) + dpr / 2, lw, rh - dpr, Math.min(4 * dpr, rh / 3));
    else g.rect(0, y(m + 0.5) + dpr / 2, lw, rh - dpr);
    g.fill();
    // a lane's name only where it shows whole, never cut by an edge
    if (col.notes[m] && y(m) > rh / 2 && y(m) < ht - rh / 2) {
      g.fillStyle = on ? col.on : col.name;
      g.font = (on ? 500 : 400) + ' ' + Math.min(12 * dpr, rh) + 'px ' + col.font;
      g.fillText(col.notes[m][0], w - 6 * dpr, y(m));
    }
  }
  const last = vis[vis.length - 1];
  const x = (t) => head - ((now - t) / 4) * head;
  if (motion) {
    g.lineWidth = 3 * dpr;
    g.lineCap = g.lineJoin = 'round';
    for (let i = 1; i < vis.length; i++) {
      const a = vis[i - 1], b = vis[i];
      if (b[0] - a[0] > 0.12) continue;
      g.strokeStyle = a[2] && b[2] ? col.perfect : col.travel;
      g.beginPath();
      g.moveTo(x(a[0]), y(a[1]));
      g.lineTo(x(b[0]), y(b[1]));
      g.stroke();
    }
  }
  if (last && now - last[0] < 0.3) {
    for (const [r, f, o] of [[13, col.on, 0.22], [5, col.head, 1]]) {
      g.globalAlpha = o;
      g.fillStyle = f;
      g.beginPath();
      g.arc(head, y(last[1]), r * dpr, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

export function attach(X) {
  const { el, data, hooks, C, M, T, local, intl, named, span, lang, panes, btn } = X;
  const notes = data.notes || {};
  const wr = (data.registers || []).find((r) => r.id === 'whistle');
  const whistleFrom = wr ? wr.low : 89;
  const manifest = data.piano && data.piano.manifest;
  const num = (x) => {
    try {
      return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);
    } catch {
      return x.toFixed(1);
    }
  };
  const hz = (x) => fill(C.hz, { hz: num(x) });
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
  // The language's own plural rule, on the number as shown: French and
  // Portuguese keep 1,8 singular, English says 1.0 octaves
  const one = (x, digits) => {
    try {
      return new Intl.PluralRules(lang, digits ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : {}).select(x) === 'one';
    } catch {
      return x === 1;
    }
  };

  let E = null, listener = null, mctx = null, raf = 0, view = null, trail = [], trails = {};
  let piano = null, pianoP = null, pctx = null, fitting = null;
  const pk = { low: null, high: null, step: 'low', win: 48 };
  addEventListener('resize', () => fitting && X.state === 'result' && fit(fitting));

  // Inside the tap that started it: the context is X's, resumed, still silent
  function listen(ctx, my) {
    mctx = ctx;
    // Faces the listening view needs, fetched now: nothing loads while the mic is live
    if (document.fonts) {
      const family = getComputedStyle(el).fontFamily;
      for (const w of [300, 400, 500]) document.fonts.load(w + ' 1em ' + family).catch(() => {});
    }
    listening();
    loadEngine().then(async (e) => {
      // the capture worklet too, before the microphone opens
      if (my === X.run && e.prepare) await e.prepare(ctx);
      if (my !== X.run) return;
      E = e;
      X.sess = new RangeSession(new E.NoteLock());
      listener = (hooks.createListener || E.createListener)({
        context: ctx,
        whistleFromMidi: whistleFrom,
        onReading: (r) => my === X.run && reading(r),
        onError: (c) => my === X.run && X.fail(c, true),
        onHint: (c, on) => my === X.run && micHint(c, on),
        onState: (s) => my === X.run && s === 'listening' && heard(),
      });
      return listener.start();
    }).catch(() => my === X.run && X.fail(ERRORS.FAILED, true));
  }

  function pill(v, on) {
    v.pill.className = 'pill ' + (on ? 'pill--on' : 'pill--off');
    setText(v.pillText, on ? C.micOn : C.micOff);
  }

  function listening() {
    const v = (view = { hints: new Set(), st: { center: X.last ? X.last.low : 48, lane: null }, t: null });
    trail = [];
    trails = {};
    v.status = h('span', null, T('stepLow'));
    v.stat = h('p', { class: 'stage__status', 'data-focus': '', tabindex: '-1' },
      h('span', { class: 'live-dot', 'aria-hidden': 'true' }), v.status);
    v.segs = [h('span', { class: 'progress__seg' }), h('span', { class: 'progress__seg' })];
    v.pillText = h('span', null, C.micOff);
    v.pill = h('span', null, icon(ICON.mic, 14), v.pillText);
    v.kicker = h('p', { class: 'rt-kicker' }, T('lowestSoFar'));
    v.name = h('span', { class: 'note-target__name' });
    v.intl = h('span', { class: 'note-target__intl' });
    v.hz = h('span', { class: 'note-target__hz' });
    v.box = h('div', { class: 'notebox note-target', 'aria-hidden': 'true' }, v.name, v.intl, v.hz);
    v.hold = h('div', { class: 'hold', 'aria-hidden': 'true' }, h('p', { class: 'hold__label' }, T('holdLabel')),
      h('div', { class: 'hold__bar' }, h('span', { class: 'hold__fill' })));
    v.canvas = h('canvas');
    v.trail = h('figure', { class: 'stage__figure trail pitch-trail rt-trail', 'aria-hidden': 'true' }, v.canvas,
      h('figcaption', null, C.pitchTrail));
    v.meter = h('div', { class: 'level-meter' }, h('span', { class: 'level-meter__fill' }),
      h('span', { class: 'level-meter__knob' }), h('span', { class: 'level-meter__gate' }));
    v.word = h('span', { class: 'meter__word' });
    // until the voice comes in, the line asks for the microphone
    v.line = h('p', { class: 'stage__line tool-panel__hint rt-line', 'aria-live': 'polite' }, C.allow);
    v.actions = h('div', { class: 'tool-panel__actions' },
      btn([icon(I.stop, 18, true), C.stop], 'btn btn--secondary btn--lg btn--strong', X.stop));
    pill(v, false);
    panes.listening.classList.remove('tool-panel__state--listening');
    put(panes.listening,
      h('div', { class: 'stage__head' }, v.stat,
        h('div', { class: 'progress', 'aria-hidden': 'true' }, v.segs), v.pill),
      h('div', { class: 'stage__main' }, h('div', { class: 'stage__notecol rt-notecol' }, v.kicker, v.box, v.hold), v.trail),
      h('div', { class: 'stage__level meter', 'aria-hidden': 'true' }, h('span', { class: 'meter__label' }, C.level), v.meter, v.word),
      v.line,
      h('div', { class: 'stage__actions' }, v.actions, X.lockline()));
    X.show('listening', true);
    const long = named(61);
    // measured with the live dot showing, as it will once the tracks are live
    panes.listening.classList.add('tool-panel__state--listening');
    for (const d of ['minHeight', 'minWidth']) reserve(v.stat, [T('stepLow'), T('stepHigh'), T('micOff')], d, v.status);
    panes.listening.classList.remove('tool-panel__state--listening');
    target(null);
    // the row keeps Stop's height or the next button's, whichever is taller
    const stop = v.actions.firstChild, tall = v.actions.offsetHeight;
    v.actions.replaceChildren(btn(T('seeResult'), 'btn btn--fill'));
    v.actions.style.minHeight = Math.max(tall, v.actions.offsetHeight) + 'px';
    v.actions.replaceChildren(stop);
    reserve(v.pill, [C.micOn, C.micOff], 'minWidth', v.pillText);
    reserve(v.kicker, [T('lowestSoFar'), T('highestSoFar')]);
    v.line.style.width = '100%';
    reserve(v.line, [C.allow, T('singLowHelp'), T('singHighHelp'), T('nowHigh'), T('lockedLow', { note: long }),
      T('lockedHigh', { note: long }), T('fryHint'), T('holdSteady'), T('whistleHint', { note: named(whistleFrom) }),
      T('aboveLowHint', { note: long })].concat([...MIC_HINTS, HINTS.BLUETOOTH].map((c) => M[c])));
  }

  // The tracks are live: from here until stopMic nothing is fetched
  function heard() {
    X.micOn = true;
    X.settings = listener.settings;
    panes.listening.classList.add('tool-panel__state--listening');
    pill(view, true);
    phaseView();
    loop();
  }

  function reading(r) {
    const s = X.sess, v = view;
    trail.push([r.t, r.hz === null ? null : r.midi + r.cents / 100, r.stable]);
    if (trail.length > 120) trail.shift();
    v.t = r.t;
    Object.assign(v, { level: E.meterLevel(r.rms), ok: !r.gated, loud: r.peak >= 0.99 });
    setText(v.word, v.loud ? C.levelLoud : v.level < E.GATE_LEVEL ? C.levelLow : C.levelGood);
    if (s.push(r)) {
      if (s.phase === 'shown') trails.low = contour(trail, s.low, r.t);
      if (s.phase === 'done') trails.high = contour(trail, s.high, r.t);
      phaseView();
    } else if (r.hz !== null && (s.phase === 'low' || s.phase === 'high')) target(r.midi, r.hz);
    lineView();
  }

  function target(m, f) {
    const v = view, gap = '\u00a0';
    if (m != null) v.box.style.setProperty('--note-chars', Math.max(2, [...local(m)].length));
    // an empty line keeps its height (a no-break space), so nothing in the box moves
    setText(v.name, m == null ? gap : local(m));
    setText(v.intl, local(60) === intl(60) ? '' : m == null ? gap : intl(m));
    setText(v.hz, m == null ? gap : hz(f));
  }

  function phaseView() {
    const s = X.sess, v = view, p = s.phase;
    setText(v.status, T(p === 'done' ? 'micOff' : p === 'high' ? 'stepHigh' : 'stepLow'));
    v.segs[0].classList.add('progress__seg--on');
    v.segs[1].classList.toggle('progress__seg--on', p === 'high' || p === 'done');
    setText(v.kicker, T(p === 'low' || p === 'shown' ? 'lowestSoFar' : 'highestSoFar'));
    if (p === 'low' || p === 'high') {
      target(null);
      X.say(T(p === 'low' ? 'singLow' : 'singHigh'));
    } else if (p === 'shown') {
      target(s.low, midiHz(s.low)); // the line, a live region, says which
    } else if (p === 'breath') {
      target(null);
    } else if (p === 'done') {
      done();
    }
    lineView();
    X.emit();
  }

  // The stage's one line: a hint while one applies, else the step's own words.
  // The headset notice, true all session, only shows until the voice comes in.
  function lineView() {
    const s = X.sess, v = view, p = s && s.phase;
    if (!p) return;
    const mic = p !== 'done' && MIC_HINTS.find((c) => v.hints.has(c));
    const k = s.hint;
    setText(v.line, mic ? M[mic]
      : k ? T(k, { note: named(k === 'whistleHint' ? whistleFrom : k === 'aboveLowHint' ? s.low : 60) })
        : p === 'low' && s.voiced < 1.5 && v.hints.has(HINTS.BLUETOOTH) ? M[HINTS.BLUETOOTH]
          : p === 'low' ? T('singLowHelp') : p === 'high' ? T('singHighHelp') : p === 'breath' ? T('nowHigh')
            : p === 'shown' ? T('lockedLow', { note: named(s.low) }) : T('lockedHigh', { note: named(s.high) }));
  }

  function done() {
    const s = X.sess, v = view;
    target(s.high, midiHz(s.high));
    stopMic();
    panes.listening.classList.remove('tool-panel__state--listening');
    pill(v, false);
    if (v.col) paint(v);
    const see = btn(T('seeResult'), 'btn btn--fill', () => result({
      low: s.low, high: s.high, source: 'mic', fry: s.fry >= FLAG_AT, whistle: s.whistle >= FLAG_AT,
      trails: { low: trails.low || null, high: trails.high || null },
    }, true));
    v.actions.replaceChildren(see);
    see.focus();
    X.say(T('micOff'));
  }

  function micHint(code, on) {
    if (on) view.hints.add(code);
    else view.hints.delete(code);
    lineView();
  }

  // One frame: the meter, the hold, the note box's lock and the trail
  function paint(v) {
    v.meter.style.setProperty('--level', v.level || 0);
    v.meter.classList.toggle('level-meter--ok', !!v.ok);
    v.meter.classList.toggle('level-meter--loud', !!v.loud);
    const s = X.sess, p = s && s.phase, lk = s && s.lock;
    const holding = (p === 'low' || p === 'high') && lk.since !== null;
    const set = p === 'shown' || p === 'done';
    v.st.lane = p === 'shown' ? s.low : p === 'done' ? s.high : holding ? lk.midi : null;
    v.hold.style.setProperty('--hold', set ? 1 : holding && v.t !== null ? Math.min(1, (v.t - lk.since) / lk.hold) : 0);
    v.box.classList.toggle('note-target--locked', set || holding);
    draw(v.canvas, trail, v.col, v.motion, v.st);
  }

  function loop() {
    const v = view;
    const css = getComputedStyle(v.trail);
    const get = (n, f) => css.getPropertyValue(n).trim() || f;
    v.col = {
      perfect: get('--trail-perfect', '#8AC4C7'), travel: get('--trail-travel', '#A8B5BA'),
      lane: get('--trail-lane', 'rgba(45, 55, 58, 0.5)'), lit: get('--trail-target', 'rgba(90, 159, 163, 0.28)'),
      name: get('--trail-label', '#A8B5BA'), on: get('--trail-label-on', '#8AC4C7'), head: get('--trail-head', '#E8EDEE'),
      font: css.fontFamily || 'sans-serif', notes,
    };
    v.motion = get('--trail-motion', '1') !== '0';
    v.meter.style.setProperty('--gate', E.GATE_LEVEL);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      paint(v);
    };
    cancelAnimationFrame(raf);
    frame();
  }

  // Stops the tracks now; resolves once the context is closed too
  function stopMic() {
    X.run++;
    cancelAnimationFrame(raf);
    raf = 0;
    const l = listener, c = mctx;
    listener = mctx = null;
    if (X.micOn) {
      X.micOn = false;
      X.emit();
    }
    return Promise.resolve(l && l.stop())
      .catch(() => {})
      .then(() => c && c.state !== 'closed' && c.close().catch(() => {}));
  }

  // Keys from a to b, white at both ends: buttons when tap is given
  function keyboard(a, b, mark, tap, tall) {
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
        : h('span', { class: cls, 'data-midi': m }, k.name && h('span', { class: 'rt-keyname' }, k.name)));
    }
    return h('div', { class: 'keyboard', style: '--whites: ' + whites + '; --keys-height: ' + tall + 'px' }, kids);
  }

  // A key's name shows only where it fits inside the key
  function fit(kb) {
    for (const s of kb.querySelectorAll('.rt-keyname')) {
      s.hidden = false;
      s.hidden = s.offsetWidth > s.parentNode.clientWidth;
    }
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

  function openPicker(focus) {
    if (pk.low === null && X.last) Object.assign(pk, { low: X.last.low, high: X.last.high });
    pk.step = 'low';
    pk.win = winOf(pk.low === null ? 48 : pk.low);
    picker(focus);
  }

  // The no-microphone path: the lowest note, then the highest, by hand. A
  // key plays when tapped, so a singer can try each one.
  function picker(focus, refocus) {
    stopMic();
    X.sess = null;
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
    }, 140);
    kb.setAttribute('role', 'group');
    kb.setAttribute('aria-label', T('keysLabel', { low: named(pk.win), high: named(pk.win + 12) }));
    kb.addEventListener('keydown', arrows);
    const shift = (d, key) => () => {
      pk.win += d;
      picker(false, '[data-shift="' + key + '"]');
    };
    const next = lowStep
      ? btn(C.next, 'btn btn--fill', () => {
        pk.step = 'high';
        if (pk.high !== null && pk.high <= pk.low) pk.high = null;
        pk.win = winOf(pk.high !== null ? pk.high : pk.low + 19);
        picker(true);
      }, { disabled: pk.low === null })
      : btn(T('showRange'), 'btn btn--fill', () => result({ low: pk.low, high: pk.high, source: 'manual' }, true),
        { disabled: pk.high === null });
    const back = btn(C.back, 'btn btn--secondary', () => {
      if (lowStep) return X.idle(true);
      pk.step = 'low';
      pk.win = winOf(pk.low);
      picker(true);
    });
    put(panes.manual,
      h('div', { class: 'stage__head' }, h('p', { class: 'rt-kicker' }, T('manualTitle'))),
      h('h3', { class: 'rt-manual__title', 'data-focus': '', tabindex: '-1' }, T(lowStep ? 'manualLow' : 'manualHigh')),
      h('div', { class: 'keyboard-bed' }, kb),
      h('div', { class: 'chips' },
        btn(T('lowerKeys'), 'btn btn--secondary btn--sm', shift(-12, 'down'), { disabled: pk.win <= PICK[0], 'data-shift': 'down' }),
        btn(T('higherKeys'), 'btn btn--secondary btn--sm', shift(12, 'up'), { disabled: pk.win >= PICK[1], 'data-shift': 'up' })),
      h('div', { class: 'rt-chosen' },
        pk.low !== null && h('p', null, T('chosenLow', { note: named(pk.low) })),
        !lowStep && pk.high !== null && h('p', null, T('chosenHigh', { note: named(pk.high) }))),
      h('div', { class: 'tool-panel__actions' }, back, next));
    X.show('manual', focus);
    const f = refocus && panes.manual.querySelector(refocus);
    if (f && !f.disabled) f.focus();
  }

  // What the whole range holds, as the app's picture says it (RangeShareCard,
  // Pablo's final range image, 2026-10-26): the bracket's large and small
  // lines in the image, the same two on the result card from three octaves.
  // From an octave to just under three, the voice type(s) the card names;
  // from three octaves, the voice types held whole; nothing under an octave.
  function bracketFor(low, high, types) {
    if (types.length) {
      return { big: types.length === 2 ? T('typeOr', { first: types[0].name, second: types[1].name }) : types[0].name,
        small: T('typical') };
    }
    if (high - low < WIDE) return null;
    const whole = typesIn(data.voiceTypes, low, high), n = whole.length;
    if (!n) return { big: T('beyondOneType'), small: span(low, high, local) };
    if (n === 1) return { big: T('typesOne', { n }), small: T('oneTypeWhole', { type: whole[0].name }) };
    return { big: n === (data.voiceTypes || []).length ? T('allTypes') : T(one(n) ? 'typesOne' : 'typesMany', { n }),
      small: T('typesSpan', { low: whole[0].name, high: whole[n - 1].name }) };
  }

  function result(res, focus) {
    stopMic();
    stopPiano();
    X.sess = null;
    const { low, high } = res;
    const before = X.last;
    const d = new Date(), z = (x) => String(x).padStart(2, '0');
    X.last = { low, high, date: d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()), source: res.source };
    try {
      localStorage.setItem(STORE, JSON.stringify(X.last));
    } catch {}
    const n = high - low, oct = n / 12, narrow = n < NARROW, wide = n >= WIDE, typed = namesAType(low, high);
    const semis = T(one(n) ? 'semitoneOne' : 'semitoneMany', { n });
    const octs = T(one(oct, true) ? 'octaveOne' : 'octaveMany', { n: num(oct) });
    const types = typed ? typicalFor(data.voiceTypes, low, high) : [];
    const typical = types.length === 2 ? T('typicalTwo', { first: types[0].name, second: types[1].name })
      : types.length ? types[0].name : '';
    const br = bracketFor(low, high, types);
    const text = span(low, high);
    const fact = (dt, dd, cls) => h('div', null, h('dt', null, dt), h('dd', cls && { class: cls }, dd));
    const mean = (ic, t) => h('li', { class: 'result-card__note' }, icon(ic, 16), h('span', null, t));
    const pair = local(low) !== intl(low) || local(high) !== intl(high);

    const [from, to] = keyWindow(low, high);
    const kb = keyboard(from, to, (m) => ({
      cls: m >= low && m <= high ? ' key--range' : '', name: (m === low || m === high) && !isBlack(m) && local(m),
    }), null, 88);
    kb.setAttribute('role', 'img');
    kb.setAttribute('aria-label', T('keyboardRange', { range: text }));
    const status = manifest && h('p', { class: 'rt-status', 'aria-live': 'polite' });
    const pianoB = manifest && btn([icon(I.play, 18, true), T('pianoButton')], 'btn btn--secondary btn--wide btn--strong',
      () => playRange(low, high, pianoB, kb, status), { 'aria-pressed': 'false' });

    // The share image: drawn here, on the device, once its module arrives
    const thumb = h('canvas', { width: 1080, height: 1920, hidden: true, role: 'img',
      'aria-label': [T('shareTitle'), text, narrow ? semis : octs, br && br.big, br && br.small].filter(Boolean).join('. ') });
    const saveB = btn([icon(I.image, 18), C.save], 'btn btn--secondary', null, { disabled: true });
    const shareB = X.nav.share && btn([icon(I.share, 18), C.share], 'btn btn--secondary', null, { disabled: true });
    const brk = data.links && data.links['voice-break-finder'];
    const P = X.platform;
    // On Android the page's band (#app) makes the app's offer with its Play
    // link: it takes the result's line, so the result shows one Play link
    const band = P === 'android' && data.playLink && document.querySelector('#app .band__body');
    if (band) setText(band, T('ctaAndroid', { range: text }));

    put(panes.result, h('div', { class: 'result result-card rt-res' },
      h('div', { class: 'rt-res__head' },
        h('p', { class: 'result-card__label' }, T('resultLabel')),
        h('p', { class: 'result-card__value', 'data-focus': '', tabindex: '-1' },
          span(low, high, local), pair && [' ', h('small', null, span(low, high, intl))]),
        h('dl', { class: 'result-card__facts' },
          fact(T('spanLabel'), narrow ? semis : T('spanValue', { semitones: semis, octaves: octs })),
          typical && fact(T('typicalLabel'), typical, 'accent'),
          wide && br && fact(br.big, br.small, 'accent'),
          before && fact(C.lastTime, T('lastTimeValue', { range: span(before.low, before.high), date: day(before.date) })))),
      h('div', { class: 'rt-res__keys' }, h('div', { class: 'keyboard-bed' }, kb), pianoB, status,
        h('div', { class: 'share share-card rt-share' }, h('span', { class: 'rt-thumb' }, thumb),
          h('div', { class: 'share-card__actions' }, saveB, shareB))),
      h('ul', { class: 'result__meaning' },
        mean(narrow ? I.info : I.clock, T(narrow ? 'tooNarrow' : 'mayChange')),
        typed && mean(I.break, T('breakMoreReliable')),
        wide && mean(I.info, T('wideNote')),
        res.fry && mean(I.info, T('fryFlag', { note: named(36) })),
        res.whistle && mean(I.info, T('whistleFlag', { note: named(whistleFrom) })),
        res.source === 'manual' && mean(I.info, T('manualNote'))),
      h('div', { class: 'rt-next' },
        brk && h('a', { class: 'btn btn--secondary btn--accent', href: brk }, T('breakButton'), icon(I.arrow, 16)),
        btn([icon(I.redo, 16), C.tryAgain], 'btn btn--secondary', () => X.idle(true))),
      !band && h('div', { class: 'result__cta' },
        h('p', null, T(P === 'android' ? 'ctaAndroid' : P === 'ios' ? 'ctaIos' : 'ctaDesktop', { range: text })),
        P === 'android' && data.playLink && h('p', { class: 'result__buttons' },
          h('a', { class: 'btn btn--primary', href: data.playLink }, T('ctaButton')),
          data.iphone && h('button', { type: 'button', class: 'btn btn--iphone', disabled: true, 'aria-disabled': 'true' },
            icon(I.iphone, 18), h('span', null, data.iphone))),
        P === 'desktop' && h('p', null, X.copyBtn()))));
    X.show('result', focus);
    fit((fitting = kb));
    X.say(T('resultLabel') + '. ' + text);

    const cs = {};
    for (let m = low; m <= high; m++) if (m % 12 === 0) cs[m] = local(m);
    const card = {
      lang, low, high,
      names: { low: { local: local(low), intl: intl(low) }, high: { local: local(high), intl: intl(high) }, a4: local(69) },
      labels: cs,
      hz: { low: round1(midiHz(low)), high: round1(midiHz(high)) },
      date: X.last.date,
      semitones: n, octaves: round1(oct),
      bracket: br,
      trails: { low: (res.trails && res.trails.low) || null, high: (res.trails && res.trails.high) || null },
      text: {
        kicker: T('shareKicker'), ref: fill(C.refPitch, { note: local(69) }), semitones: semis, octaves: octs,
        caption: T('shareTwoLines'), ask: T('shareAsk'), site: new URL(X.canonical()).host, hz: C.hz,
      },
    };
    import('./share-card.js').then(async (m) => {
      await m.drawRangeCard(thumb, card);
      const file = await m.toFile(thumb, T('shareFileName') + '.png');
      if (!file) throw new Error('no image');
      thumb.hidden = false;
      const url = X.canonical();
      if (shareB) {
        shareB.disabled = false;
        shareB.addEventListener('click', () => m.share(file, { title: T('shareTitle'), text: T('shareText', { range: text }) + ' ' + url, url }));
      }
      saveB.disabled = false;
      saveB.addEventListener('click', () => {
        m.save(file);
        X.say(T('saved'));
      });
    }).catch(() => {
      for (const b of [shareB, saveB]) if (b) b.hidden = true;
    });
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
    const my = X.playing;
    if (!my) return;
    X.playing = null;
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
    if (X.playing) return stopPlaying(true);
    let c;
    try {
      c = pianoCtx();
    } catch {
      return;
    }
    const keys = kb.querySelectorAll('[data-midi]');
    const my = (X.playing = {
      reset: () => {
        b.setAttribute('aria-pressed', 'false');
        setText(status, '');
        for (const k of keys) k.classList.remove('key--active');
      },
    });
    b.setAttribute('aria-pressed', 'true');
    // its room, taken inside the tap, so the words that follow move nothing
    if (!status.style.minHeight) reserve(status, [C.loading, T('pianoPlaying')]);
    setText(status, C.loading);
    pianoReady().then(async (p) => {
      if (X.playing !== my) return;
      if (!p) return stopPlaying(false);
      await p.prepareRange(low, high, { margin: 0 });
      if (X.playing !== my) return;
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
        if (X.playing !== my) return;
        const now = (c.currentTime - t0) * 1000;
        const on = new Set(seq.filter(([, at, len]) => now >= at && now < at + len).map((s) => s[0]));
        for (const k of keys) k.classList.toggle('key--active', on.has(+k.dataset.midi));
        if (now > end) return stopPlaying(false);
        my.raf = requestAnimationFrame(tick);
      };
      tick();
    });
  }

  return {
    listen,
    picker: openPicker,
    preload: loadEngine,
    halt() {
      stopMic();
      stopPiano();
    },
  };
}
