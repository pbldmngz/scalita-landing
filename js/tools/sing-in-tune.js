/*
 * The sing-in-tune test once Start is tapped, loaded with the engines by
 * sing-in-tune-test.js (the idle panel): the three runs, their results, and
 * the rules that read a sung note the way the app reads one
 * (scale_scorer.dart, score_analysis.dart).
 *   sing   the piano plays a note, then the microphone opens and the singer
 *          sings it back; five notes
 *   tuner  the microphone only: the nearest note and how far from its center
 *   ear    the piano only: two notes, higher or lower, three pairs
 * The microphone and the piano take turns, never together: a note is
 * scheduled only once every mic track has stopped, and the mic opens only
 * once the piano is silent and has handed the audio session back. Results
 * are pitch in cents and nothing else, never a verdict on the voice. A sing
 * result draws its share image through share-tune.js (drawTuneCard), each
 * note's line from the readings measureNote kept, after the microphone is off.
 * The panes use the stage's markup (css/style.css) and css/tool-tune.css.
 * Tests may set globalThis.__scalitaTest before the page loads: targets (a
 * round's notes), pairs (the listening check's), seed, and events, where
 * every turn is pushed with micLive and pianoBusy as they were then.
 */

import { micIsLive } from '../audio/mic.js';

export const ROUND = 5;
export const MIN_JUDGED = 3; // fewer measured and a round shows no figures
export const MIN_READINGS = 6; // about 280 ms of believed pitch in a note's middle
export const IN_TUNE = 10; // cents: the app's two bands (scale_scorer.dart)
export const CLOSE = 25;
export const LEAN = 10; // a lean this size is named (score_analysis.dart)
export const EAR_STEPS = [4, 2, 1];
const RING_MS = 1200; // the piano's note
const SING_S = 1.6; // captured once the voice starts
const MIN_SUNG_S = 0.8; // after this much, a pause of STOP_S ends the note
const STOP_S = 0.4;
const NO_VOICE_S = 8; // nothing in this long: not heard, not counted
const LOCK_S = 0.6; // held stable this long, the note box turns solid
const PAUSE_MS = 1100; // a measured note stays on screen
const SMOOTH = 0.18; // the needle, per 60 Hz frame (pitch_trail_display.dart:221)
const WINDOW_S = 4; // the trail's width in time
const HINTS = ['micSilent', 'micBluetooth', 'levelLoud', 'levelQuiet'];
const BLANK = String.fromCharCode(160); // keeps an empty line's height

export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
// Dart's round(): halves away from zero, as the app rounds its figures
const round = (x) => Math.sign(x) * Math.round(Math.abs(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const race = (p, ms) => Promise.race([p, sleep(ms)]);

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// hz against midi, folded into the nearest octave of it: a note sung an
// octave down is the note, sung an octave down
export function offset(hz, midi) {
  const c = 1200 * Math.log2(hz / midiToHz(midi));
  const octave = Math.round(c / 1200);
  return { cents: c - 1200 * octave, octave };
}

// The middle of a range as the app cuts one (echo_plan.dart): the half
// between its bottom and top fourths, five notes at least
export function middleBand(low, high) {
  const q = Math.floor((high - low) / 4);
  let lo = low + q;
  let hi = high - q;
  while (hi - lo < 4) {
    lo--;
    hi++;
  }
  return [lo, hi];
}

// "Any voice": the middle of the six voice-type presets' own bands
export function anyBand(types) {
  const b = (types || []).map((v) => middleBand(v.presetLow, v.presetHigh));
  if (!b.length) return [57, 69];
  return [round(median(b.map((x) => x[0]))), round(median(b.map((x) => x[1])))];
}

export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n notes of the band, shuffled, no note twice in a row
export function pickTargets([lo, hi], n, rand) {
  const pool = [];
  for (let m = lo; m <= hi; m++) pool.push(m);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

// One sung note, read as the app reads one (scale_scorer.dart): the median
// of its middle, head and tail trimmed in time (150 and 75 ms at most), and
// its wobble, the median movement once the voice arrived within 50 cents
// (heldSpread); path, every reading's cents in order, for the share image.
// readings: believed {t, hz}, in order. Null if too little.
export function measureNote(readings, midi) {
  if (readings.length < 2) return null;
  const t0 = readings[0].t;
  const t1 = readings[readings.length - 1].t;
  const len = t1 - t0;
  const all = readings.map((r) => ({ t: r.t, ...offset(r.hz, midi) }));
  const mid = all.filter((x) => x.t >= t0 + Math.min(0.15, 0.3 * len) && x.t <= t1 - Math.min(0.075, 0.15 * len));
  if (mid.length < MIN_READINGS) return null;
  const from = all.findIndex((x) => Math.abs(x.cents) <= 50);
  const held = from < 0 ? [] : all.slice(from).filter((x) => x.t <= t1 - 0.1).map((x) => x.cents);
  const centre = median(held);
  return {
    cents: median(mid.map((x) => x.cents)),
    octave: round(median(mid.map((x) => x.octave))),
    wobble: held.length >= 5 ? median(held.map((c) => Math.abs(c - centre))) : null,
    path: all.map((x) => x.cents), // the share image draws it
  };
}

// A round, in the app's figures (score_analysis.dart): off, the median
// distance whichever way; lean, the median signed offset, named from 10
// cents; wobble, the median of the notes' wobbles; and how many notes sat
// inside the trail's two bands
export function summarize(notes) {
  const judged = notes.filter(Boolean);
  const out = { total: notes.length, judged: judged.length, enough: judged.length >= MIN_JUDGED };
  if (!out.enough) return out;
  const offs = judged.map((n) => n.cents);
  const lean = median(offs);
  const wobble = median(judged.map((n) => n.wobble).filter((w) => w != null));
  out.off = round(median(offs.map(Math.abs)));
  out.lean = Math.abs(lean) >= LEAN ? round(lean) : null;
  out.wobble = wobble == null ? null : round(wobble);
  out.inTune = offs.filter((c) => Math.abs(c) <= IN_TUNE).length;
  out.close = offs.filter((c) => Math.abs(c) <= CLOSE).length;
  return out;
}

// The listening check's pairs inside a band: steps of 4, 2, 1 semitones,
// each up or down at random
export function earPairs([lo, hi], rand) {
  return EAR_STEPS.map((step) => {
    const up = rand() < 0.5;
    const low = lo + Math.floor(rand() * (Math.max(0, hi - lo - step) + 1));
    return up ? { a: low, b: low + step, up, step } : { a: low + step, b: low, up, step };
  });
}

// Icons from the site's shared set (24 x 24); ui.icon draws them
const REDO = 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5';
const STOP = 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z';
const IMAGE = 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0M21 16l-5-5-8 8';
const SHARE = 'M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7';
const DOWNLOAD = 'M12 4v11M7 10l5 5 5-5M4 20h16';
const IPHONE = 'M8.5 2h7A2.5 2.5 0 0 1 18 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 19.5v-15A2.5 2.5 0 0 1 8.5 2zM11 18h2';
const TUNE = 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v4M12 18v4M2 12h4M18 12h4';
const TICKS = [-50, -25, 0, 25, 50];

// The cents meter along the top and the trail under it, on one canvas, in
// the colours of the page's tokens and .pitch-trail: the meter spans 50
// cents either way with the two bands, each lane under it is a semitone, the
// target's lane is lit and named, the voice draws its line into it. A phone
// gets the compact face (no padding, three labels, 22 px lanes).
function scope(wrap, ui) {
  const cv = ui.h('canvas', { 'aria-hidden': 'true' });
  wrap.append(cv);
  const g = cv.getContext('2d');
  const css = getComputedStyle(wrap);
  const v = (n, d) => css.getPropertyValue(n).trim() || d;
  const col = {
    perfect: v('--trail-perfect', '#8AC4C7'), close: v('--trail-close', '#5A9FA3'), off: v('--trail-off', '#C4A87A'),
    lane: v('--trail-lane', 'rgba(45,55,58,.5)'), target: v('--trail-target', 'rgba(90,159,163,.28)'),
    label: v('--trail-label-on', '#8AC4C7'), head: v('--trail-head', '#E8EDEE'),
    ocean: v('--ocean', '#5A9FA3'), mist: v('--mist', '#3A4548'), soft: v('--soft', '#A8B5BA'), glow: v('--glow', '#8AC4C7'),
  };
  const moving = v('--trail-motion', '1') !== '0';
  const tone = (c) => (Math.abs(c) <= IN_TUNE ? col.perfect : Math.abs(c) <= CLOSE ? col.close : col.off);
  const marks = TICKS.map((k) => ui.sign(k));
  const seg = (x0, y0, x1, y1) => {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const fill = (a, colour, shape) => {
    g.globalAlpha = a;
    g.fillStyle = colour;
    g.beginPath();
    shape();
    g.fill();
  };
  const rect = (x, y, w, h, r) => () => (g.roundRect && r ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));
  const disc = (x, y, r) => () => g.arc(x, y, r, 0, 7);
  let pts = [];
  return {
    push: (t, y, c) => pts.push({ t, y, c }),
    clear: () => { pts = []; },
    // o: needle (cents or null), centre (MIDI, fractional), target (the lit
    // lane, MIDI or null), label (its name)
    draw(now, o) {
      const w = cv.clientWidth;
      const ht = cv.clientHeight;
      if (!g || !w || !ht) return;
      const d = globalThis.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * d) || cv.height !== Math.round(ht * d)) {
        cv.width = Math.round(w * d);
        cv.height = Math.round(ht * d);
      }
      g.setTransform(d, 0, 0, d, 0, 0);
      g.clearRect(0, 0, w, ht);
      g.lineCap = g.lineJoin = 'round';
      const small = w < 480;
      const k = small ? 0.8 : 1;
      // The meter: the 25 and 10 cent bands, the scale, the needle
      const base = small ? 26 : 36;
      const half = w / 2 - Math.max(13, w * 0.052);
      const nx = (c) => w / 2 + (Math.max(-50, Math.min(50, c)) / 50) * half;
      const bh = small ? 12 : 14;
      fill(0.16, col.ocean, rect(nx(-CLOSE), base - bh, nx(CLOSE) - nx(-CLOSE), 2 * bh, 6 * k));
      fill(0.22, col.ocean, rect(nx(-IN_TUNE), base - bh, nx(IN_TUNE) - nx(-IN_TUNE), 2 * bh, 6 * k));
      g.globalAlpha = 1;
      g.strokeStyle = col.mist;
      g.lineWidth = 2;
      seg(nx(-50), base, nx(50), base);
      g.globalAlpha = 0.8;
      g.strokeStyle = col.soft;
      g.lineWidth = 1.5;
      for (const c of TICKS) {
        const len = (c ? (Math.abs(c) === 50 ? 8 : 6) : 12) * k;
        seg(nx(c), base - len, nx(c), base + len);
      }
      g.globalAlpha = 1;
      g.fillStyle = col.soft;
      g.font = (small ? 10 : 11) + 'px Sora, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      TICKS.forEach((c, i) => (small && i % 2 ? 0 : g.fillText(marks[i], nx(c), base + 24)));
      if (o.needle != null) {
        const x = nx(o.needle);
        if (!small) fill(0.25, col.glow, disc(x, base, 10));
        g.globalAlpha = 1;
        const nl = small ? 16 : 22;
        g.strokeStyle = col.head;
        g.lineWidth = 3;
        seg(x, base - nl, x, base + nl);
      }
      // The lanes, a semitone each, around the centre
      const top = small ? 64 : 72;
      const bot = ht;
      if (small) {
        g.strokeStyle = col.mist;
        g.lineWidth = 1;
        seg(0, 62.5, w, 62.5);
      }
      const gap = small ? 2 : 1;
      const n = 2 * Math.max(1, Math.round(((bot - top + gap) / ((small ? 22 : 31) + gap) - 1) / 2)) + 1;
      const step = (bot - top + gap) / n;
      const mid = (top + bot) / 2;
      const y = (m) => mid - (m - o.centre) * step;
      g.save();
      g.beginPath();
      g.rect(0, top, w, bot - top);
      g.clip();
      for (let m = Math.floor(o.centre - n / 2) - 1; m <= Math.ceil(o.centre + n / 2) + 1; m++) {
        fill(1, m === o.target ? col.target : col.lane, rect(0, y(m) - (step - gap) / 2, w, step - gap, small ? 0 : 4));
      }
      if (o.label && o.target != null) {
        g.fillStyle = col.label;
        g.font = '500 ' + (small ? 11 : 12) + 'px Sora, sans-serif';
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(o.label, small ? 10 : 12, y(o.target));
      }
      // The voice: its line, newest at the head, and the head's dot
      pts = pts.filter((p) => now - p.t <= WINDOW_S + 0.5);
      const head = w - Math.min(60, w * 0.07);
      const sx = head / WINDOW_S;
      g.lineWidth = 3;
      let prev = null;
      for (const p of moving ? pts : pts.slice(-1)) {
        const x = head - (now - p.t) * sx;
        const yy = y(p.y);
        if (prev && p.t - prev.t < 0.15 && Math.abs(p.y - prev.y) < 1.5) {
          g.strokeStyle = tone(p.c);
          seg(prev.x, prev.yy, x, yy);
        }
        prev = { t: p.t, y: p.y, x, yy };
      }
      if (prev && now - prev.t < 0.3) {
        fill(0.22, col.glow, disc(prev.x, prev.yy, small ? 10 : 13));
        fill(1, col.head, disc(prev.x, prev.yy, small ? 4.5 : 5));
      }
      g.restore();
      g.globalAlpha = 1;
    },
  };
}

// One run, from the Start tap to its result. ui: what sing-in-tune-test.js
// keeps for the mount; my: this run's token; E: the engines.
export function begin(ui, my, E) {
  const { t, c, M, h, fmt, pd, test, icon } = ui;
  const [, runV, resV] = ui.panes;
  const pr = new Intl.PluralRules(ui.lang);
  const plural = (o, n) => (o && (o[pr.select(n)] || o.other)) || '';
  const cents = (n) => fmt(plural(t('units.cents'), n), { n });
  const hzText = new Intl.NumberFormat(ui.lang, { maximumFractionDigits: 1 });
  const playable = ((pd.piano && pd.piano.manifest && pd.piano.manifest.notes) || []).map((n) => n.midi);
  const pLow = playable.length ? Math.min(...playable) - 1 : 32;
  const pHigh = playable.length ? Math.max(...playable) + 1 : 91;
  const gone = () => my !== ui.run;
  const seed = test && test.seed != null ? test.seed : (Math.random() * 2 ** 32) >>> 0;
  const usesPiano = ui.mode !== 'tuner';
  let listener = null;
  let capture = null; // the note being sung
  let raf = 0;
  let view = {};
  let prompt = '';
  const hints = new Set();

  ui.stopAudio = () => {
    cancelAnimationFrame(raf);
    if (capture) capture.end('stop');
    capture = null;
    if (listener) listener.stop();
    listener = null;
    if (ui.ctx && usesPiano) E.piano.release();
    hints.clear();
  };
  ui.onHide = () => (ui.mode === 'sing' ? ui.fail('micHidden') : ui.mode === 'ear' && E.piano.stopAll());
  if (usesPiano) {
    E.piano.init(pd.piano && pd.piano.manifest, (pd.piano && pd.piano.base) || '/audio/piano-web/');
    E.piano.useContext(ui.ctx);
  }

  function hook(kind, extra) {
    if (test && Array.isArray(test.events)) {
      test.events.push({ kind, at: Date.now(), micLive: micIsLive(), pianoBusy: E.piano.isBusy(), ...extra });
    }
  }

  function band() {
    const [lo0, hi0] = ui.voice === 'saved' && ui.saved ? middleBand(ui.saved.low, ui.saved.high)
      : (() => {
        const v = ui.types.find((x) => x.id === ui.voice);
        return v ? middleBand(v.presetLow, v.presetHigh) : anyBand(ui.types);
      })();
    const lo = Math.max(pLow, Math.min(lo0, pHigh - 4));
    return [lo, Math.max(lo + 4, Math.min(hi0, pHigh))];
  }

  function offsetText(cv, octave) {
    const r = round(cv);
    const s = r ? fmt(t(r > 0 ? 'offset.high' : 'offset.low'), { cents: cents(Math.abs(r)) }) : t('offset.zero');
    return octave ? fmt(t(octave > 0 ? 'offset.octaveUp' : 'offset.octaveDown'), { offset: s }) : s;
  }

  function makeListener() {
    return E.createListener({
      context: ui.ctx,
      onReading: (r) => !gone() && reading(r),
      onError: (code) => !gone() && ui.fail(code),
      onHint: (code, on) => {
        if (gone()) return;
        if (on) hints.add(code);
        else hints.delete(code);
        paintHint();
      },
      onState: (s) => !gone() && mic(s === 'listening'),
    });
  }

  // Whether a microphone track is live, said three ways: the pane's
  // listening class (its dot), the Mic on pill (its room kept, so nothing
  // moves while the piano takes its turn), and a meter at rest when not
  function mic(on) {
    const v = view;
    runV.classList.toggle('tool-panel__state--listening', on);
    if (!v.pill) return;
    v.pill.style.visibility = on ? '' : 'hidden';
    if (!on) level(null);
  }

  function level(r) {
    const v = view;
    const lvl = r ? E.pitch.meterLevel(r.rms) : 0;
    v.meter.style.setProperty('--level', lvl.toFixed(3));
    v.meter.setAttribute('aria-valuenow', String(Math.round(lvl * 100)));
    v.meter.classList.toggle('level-meter--ok', !!r && !r.gated);
    v.word.textContent = r ? c(r.peak >= 0.99 ? 'levelLoud' : lvl < E.pitch.GATE_LEVEL ? 'levelLow' : 'levelGood') : BLANK;
  }

  function paintHint() {
    const code = HINTS.find((k) => hints.has(k));
    const v = view;
    if (v.hint) {
      if (code && code !== v.hintCode) ui.say(M[code] || '');
      v.hintCode = code;
      v.hint.textContent = (code ? M[code] : prompt) || BLANK;
    }
    if (v.meter) v.meter.classList.toggle('level-meter--loud', hints.has('levelLoud'));
    if (!gone()) ui.hold();
  }

  function setPrompt(text, status) {
    prompt = text;
    if (status != null) view.label.textContent = status;
    paintHint();
  }

  function setBox(m) {
    const v = view;
    if (v.boxMidi === m) return;
    v.boxMidi = m;
    const [l, i] = m == null ? [BLANK, BLANK] : ui.names(m);
    v.name.textContent = l;
    v.name.style.setProperty('--note-chars', String([...l].length));
    v.hz.textContent = m == null ? BLANK : fmt(c('hz'), { hz: hzText.format(midiToHz(m)) });
    v.intl.textContent = i;
    v.intl.hidden = l === i;
  }

  // On the note within the app's in-tune band, the exact figure under it
  function readout(cv) {
    const r = cv == null ? null : round(cv);
    const near = r != null && Math.abs(r) <= IN_TUNE;
    view.main.textContent = r == null ? BLANK : near ? t('offset.zero') : offsetText(r);
    view.sub.textContent = near && r ? offsetText(r) : BLANK;
  }

  // The run pane for sing and tuner: the head (status, progress, pill), the
  // note column (kicker, note box, readout) beside the meter and trail, the
  // level, the line, the actions
  function runPane(kind) {
    const sing = kind === 'sing';
    const wrap = h('figure', { class: 'stage__figure pitch-trail trail' }, h('figcaption', { text: t('cents') }));
    view = {
      kind,
      dot: h('span', { class: 'live-dot' }),
      label: h('span'),
      pill: h('span', { class: 'pill pill--on' }, icon(ui.I.mic, 14), c('micOn')),
      steps: sing ? Array.from({ length: ROUND }, () => h('span', { class: 'progress__seg' })) : [],
      name: h('span', { class: 'note-target__name' }),
      hz: h('span', { class: 'note-target__hz' }),
      intl: h('span', { class: 'note-target__intl' }),
      main: h('span', { class: 'st-readout__main' }),
      sub: h('span', { class: 'st-readout__sub' }),
      meter: h('div', { class: 'level-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': t('meter') },
        h('span', { class: 'level-meter__fill' }), h('span', { class: 'level-meter__gate' }), h('span', { class: 'level-meter__knob' })),
      word: h('span', { class: 'meter__word' }),
      hint: h('p', { class: 'stage__line' }),
      again: sing ? ui.button(t('sing.again'), () => capture && capture.end('again'), 'btn-secondary btn--lg btn--strong', { disabled: true }, icon(REDO)) : null,
      smooth: 0, lockSince: null, voiceAt: -1, at: 0, said: 0, frozen: null,
    };
    view.box = h('div', { class: 'notebox note-target' }, view.name, view.hz, view.intl);
    setBox(null);
    readout(null);
    const stop = ui.button(c('stop'), () => ui.halt(), 'btn-secondary btn--lg' + (sing ? '' : ' btn--strong'), null, icon(STOP, 18, true));
    runV.replaceChildren(
      h('div', { class: 'stage__head' }, h('p', { class: 'stage__status tool-panel__status' }, view.dot, view.label),
        sing ? h('div', { class: 'progress progress--short', 'aria-hidden': 'true' }, ...view.steps) : null, view.pill),
      h('div', { class: 'stage__main' },
        h('div', { class: 'stage__notecol' }, h('p', { class: 'kicker kicker--soft', text: t(sing ? 'pianoPlayed' : 'tuner.nearest') }),
          view.box, h('p', { class: 'st-readout' }, view.main, view.sub)),
        wrap),
      h('div', { class: 'stage__level meter' }, h('span', { class: 'meter__label', text: c('level') }), view.meter, view.word),
      view.hint,
      h('div', { class: 'stage__actions' }, h('div', { class: 'tool-panel__actions' }, view.again, stop), ui.lockline()));
    mic(false);
    view.meter.style.setProperty('--gate', E.pitch.GATE_LEVEL.toFixed(3));
    view.scope = scope(wrap, ui);
    ui.show(runV, stop);
    // On a phone the tab bar floats over the page's foot: Stop is brought
    // clear of it for the round (the stylesheet's scroll-padding-bottom
    // keeps the bar's height out of view)
    const bar = document.querySelector('.site-tabbar');
    if (bar && bar.getClientRects().length) stop.scrollIntoView({ block: 'nearest' });
    raf = requestAnimationFrame(frame);
  }

  function frame(ms) {
    raf = requestAnimationFrame(frame);
    if (!ui.ctx || !view.scope) return;
    const dt = view.at ? Math.min(0.25, (ms - view.at) / 1000) : 0;
    view.at = ms;
    const now = ui.ctx.currentTime;
    const voiced = now - view.voiceAt < 0.3;
    // Time-based, so it settles as the app's does at any refresh rate
    if (voiced && view.needle != null) view.smooth += (view.needle - view.smooth) * (1 - (1 - SMOOTH) ** (dt * 60));
    const sing = view.kind === 'sing';
    // Sing lights the piano's note; the tuner, the nearest one
    const target = sing ? view.boxMidi : view.goal;
    if (!sing && view.centre != null) view.centre += (view.goal - view.centre) * Math.min(1, dt * 4);
    view.scope.draw(now, {
      needle: view.frozen != null ? view.frozen : voiced ? view.smooth : null,
      centre: sing ? (target == null ? 60 : target) : view.centre == null ? 60 : view.centre,
      target, label: target == null ? '' : ui.names(target)[0],
    });
    if (view.frozen == null && ms - view.said > 250) {
      view.said = ms;
      readout(voiced ? view.smooth : null);
    }
  }

  function reading(r) {
    const v = view;
    if (!v.meter) return;
    level(r);
    if (r.stable) {
      if (v.lockSince == null) v.lockSince = r.t;
    } else if (!r.outside) v.lockSince = null;
    v.box.classList.toggle('note-target--locked', v.lockSince != null && r.t - v.lockSince >= LOCK_S);
    if (v.kind === 'tuner') {
      if (r.hz == null) return;
      if (r.midi !== v.boxMidi) {
        v.smooth = r.cents;
        v.lockSince = null;
      }
      setBox(r.midi);
      if (v.centre == null) v.centre = r.midi;
      v.goal = r.midi;
      v.needle = r.cents;
      v.voiceAt = r.t;
      v.scope.push(r.t, 12 * Math.log2(r.hz / 440) + 69, r.cents);
      return;
    }
    const cap = capture;
    if (!cap) return;
    if (cap.opened == null) cap.opened = r.t;
    if (r.hz != null) {
      const o = offset(r.hz, cap.midi);
      if (cap.onset == null) {
        cap.onset = r.t;
        v.smooth = o.cents;
      }
      cap.readings.push({ t: r.t, hz: r.hz });
      cap.voiceAt = r.t;
      v.needle = o.cents;
      v.voiceAt = r.t;
      v.scope.push(r.t, cap.midi + o.cents / 100, o.cents);
    }
    if (cap.onset == null) {
      if (r.t - cap.opened >= NO_VOICE_S) cap.end('done');
    } else if (r.t - cap.onset >= SING_S || (r.t - cap.onset >= MIN_SUNG_S && r.t - cap.voiceAt >= STOP_S)) {
      cap.end('done');
    }
  }

  async function micRun() {
    runPane(ui.mode);
    setPrompt(c('allow'), c('listening'));
    // the capture worklet before the microphone: nothing loads while it is live
    if (E.prepare) await E.prepare(ui.ctx);
    if (gone()) return;
    listener = makeListener();
    hook('mic');
    if (!(await listener.start()) || gone()) return;
    if (ui.mode === 'tuner') {
      setPrompt(t('tuner.hint'));
      ui.say(t('tuner.hint'));
      return;
    }
    // The microphone first, alone: the permission prompt and every failure
    // come before the first note. Then the piano.
    await listener.stop();
    if (gone()) return;
    setPrompt('', c('loading'));
    const targets = test && test.targets ? test.targets.slice(0, ROUND) : pickTargets(band(), ROUND, random(seed));
    const bufs = await Promise.all([...new Set(targets)].map((m) => E.piano.ensureNote(m)));
    if (gone()) return;
    if (bufs.some((b) => !b)) return ui.fail('pianoFailed');
    const notes = [];
    for (let i = 0; i < targets.length; i++) {
      const m = await singNote(targets[i], i, targets.length);
      if (gone()) return;
      notes.push(m);
    }
    result(summarize(notes), notes, targets);
  }

  async function singNote(midi, i, total) {
    const status = fmt(t('sing.noteOf'), { n: i + 1, total });
    const piano = E.piano;
    view.steps.forEach((s, k) => s.classList.toggle('progress__seg--on', k <= i));
    for (;;) {
      // The piano's turn: no microphone track is live
      view.again.disabled = true;
      setBox(midi);
      view.box.classList.remove('note-target--locked');
      view.scope.clear();
      view.voiceAt = -1;
      view.lockSince = view.frozen = null;
      readout(null);
      setPrompt(t('sing.listen'), status);
      ui.say(status + '. ' + t('sing.listen'));
      if (micIsLive()) await listener.stop();
      hook('piano', { midi });
      const voice = await piano.playNote(midi, { ringMs: RING_MS });
      if (gone()) return null;
      if (!voice) {
        ui.fail('pianoFailed');
        return null;
      }
      await race(piano.whenIdle(), RING_MS + 150);
      piano.release();
      await race(piano.whenIdle(), 300);
      if (gone()) return null;
      if (piano.isBusy()) {
        ui.fail('micInterrupted');
        return null;
      }
      // The microphone's turn: the piano is silent
      let end;
      const ended = new Promise((resolve) => { end = resolve; });
      const cap = (capture = { midi, readings: [], opened: null, onset: null, voiceAt: null, end: (why) => end(why) });
      setPrompt(t('sing.now'));
      ui.say(t('sing.now'));
      hook('mic', { midi });
      if (!(await listener.start()) || gone()) return null;
      view.again.disabled = false;
      const why = await ended;
      capture = null;
      if (gone()) return null;
      view.again.disabled = true;
      await listener.stop();
      if (gone()) return null;
      if (why === 'again') continue;
      const m = measureNote(cap.readings, midi);
      const text = m ? offsetText(m.cents, m.octave) : t('sing.notHeard');
      // the readout already says how far it landed: the line does not repeat it
      setPrompt(m ? '' : text);
      view.frozen = m ? m.cents : null;
      readout(m ? m.cents : null);
      ui.say(m ? fmt(t('sing.measured'), { n: i + 1, offset: text }) : text);
      await sleep(PAUSE_MS);
      return gone() ? null : m;
    }
  }

  // Back to the idle pane in another mode, beside the result's main action
  function other(mode, text, ic) {
    return ui.button(text || t('modes.' + mode), () => {
      ui.mode = mode;
      ui.showIdle(true);
    }, 'btn-secondary', null, ic);
  }

  function facts(rows) {
    return h('dl', { class: 'result-card__facts' }, ...rows.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))));
  }

  // The app's offer, where the page has no band of its own: the band (#app),
  // just under the stage, makes the same offer in the same words with its
  // Play link, so the result adds none (one Play link, as S2-tune has it)
  function cta() {
    if (document.getElementById('app')) return '';
    const android = /Android/i.test((globalThis.navigator && navigator.userAgent) || '');
    return h('div', { class: 'result__cta' }, h('p', { text: t('result.ctaBody') }),
      android && pd.playLink
        ? h('p', { class: 'result__buttons' },
          h('a', { class: 'btn btn-primary', href: pd.playLink, rel: 'noopener' }, icon(DOWNLOAD), t('result.ctaButton')),
          pd.iphone && h('button', { type: 'button', class: 'btn btn--iphone', disabled: true, 'aria-disabled': 'true' },
            icon(IPHONE), h('span', { text: pd.iphone })))
        : h('p', { text: pd.androidOnlyLine || '' }));
  }

  // One note of the round: its name and how far it landed, a dot for a note
  // not heard; the reading in words for a screen reader and a pointer
  function noteCard(m, n) {
    const full = ui.label(m) + ': ' + (n ? offsetText(n.cents, n.octave) : t('sing.notHeard'));
    return h('li', { class: 'notecard' + (n && Math.abs(n.cents) > CLOSE ? ' notecard--miss' : ''), title: full },
      h('span', { class: 'notecard__note', 'aria-hidden': 'true', text: ui.names(m)[0] }),
      h('span', { class: 'notecard__offset', 'aria-hidden': 'true', text: n ? ui.short(round(n.cents), true) : '·' }),
      h('span', { class: 'sr-only', text: full }));
  }

  // The image to share, drawn on this device by share-tune.js once it loads:
  // Save image and Share wait for it, and go if it cannot be drawn
  function shareRow(sum, notes, targets) {
    const d = new Date();
    const url = (document.querySelector('link[rel=canonical]') || location).href;
    const half = sum.inTune >= Math.ceil(sum.judged / 2);
    const data = {
      lang: ui.lang,
      date: [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((x) => String(x).padStart(2, '0')).join('-'),
      off: sum.off, judged: sum.judged, total: sum.total, inTune: sum.inTune, close: sum.close, wobble: sum.wobble,
      notes: targets.map((m, i) => ({ name: ui.names(m)[0], cents: notes[i] ? round(notes[i].cents) : null, path: notes[i] ? notes[i].path : null })),
      text: {
        title: t('share.title'), cents: t('share.cents'), typical: fmt(t('share.typical'), { n: sum.judged }),
        line2: [fmt(t(half ? 'share.within10' : 'share.within25'), { n: half ? sum.inTune : sum.close, total: sum.judged }),
          sum.wobble == null ? '' : fmt(t('share.wobble'), { cents: cents(sum.wobble) })].filter(Boolean).join(' · '),
        bandClose: t('share.bandClose'), bandIn: t('share.bandIn'), theNote: t('share.theNote'), lines: t('share.lines'),
        ask: t('share.ask'), site: new URL(url).host,
      },
    };
    const cv = h('canvas', { width: 1080, height: 1920, role: 'img', hidden: true,
      'aria-label': [t('share.title'), cents(sum.off), data.text.typical].join('. ') });
    const save = ui.button(c('save'), null, 'btn-secondary', { disabled: true }, icon(IMAGE));
    const send = globalThis.navigator && navigator.share ? ui.button(c('share'), null, 'btn-secondary', { disabled: true }, icon(SHARE)) : null;
    const row = h('div', { class: 'share share-card' }, cv, h('div', { class: 'share-card__actions' }, save, send));
    ui.share().then(async (s) => {
      await s.drawTuneCard(cv, data);
      const file = await s.toFile(cv, t('share.fileName') + '.png');
      if (!file) return row.remove();
      cv.hidden = save.disabled = false;
      save.onclick = () => s.save(file);
      if (send) {
        send.disabled = false;
        send.onclick = () => s.share(file, { title: t('share.title'), text: fmt(t('share.text'), { cents: cents(sum.off), n: sum.judged }) + ' ' + url, url });
      }
    }).catch(() => row.remove());
    return row;
  }

  function result(sum, notes, targets) {
    ui.halt(false);
    const last = ui.load(ui.keys.last);
    const card = h('div', { class: 'result result-card' }, h('p', { class: 'result-card__label', text: t('result.label') }));
    const side = [];
    const count = (n) => fmt(t('result.count'), { n, total: sum.judged });
    if (sum.enough) {
      // "further than 0 cents" only a test tone earns: the figure says it alone
      const line = [sum.off ? fmt(t('result.offSay'), { cents: cents(sum.off) }) : '',
        sum.lean == null ? '' : t(sum.lean > 0 ? 'result.offHigh' : 'result.offLow')].filter(Boolean).join(' ');
      card.append(
        h('p', { class: 'result-card__value' }, ui.short(sum.off) + ' ', h('small', { text: fmt(t('result.basis'), { judged: sum.judged, total: sum.total }) })),
        line ? h('p', { class: 'result-card__note st-say', text: line }) : '', // append() prints a null as text
        facts([[t('result.within10'), count(sum.inTune)], [t('result.within25'), count(sum.close)],
          ...(sum.wobble == null ? [] : [[t('result.wobble'), ui.short(sum.wobble)]])]),
        h('p', { class: 'result-card__note', text: sum.wobble == null ? t('result.wobbleNone')
          : (sum.wobble ? fmt(t('result.wobbleSay'), { cents: cents(sum.wobble) }) + ' ' : '') + t('result.wobbleRead') }),
        h('p', { class: 'result-card__note', text: t('result.cent') + ' ' + t('result.sample') }));
      const before = ui.lastLine(last);
      if (before) card.append(h('p', { class: 'result-card__note', text: before }));
      ui.store(ui.keys.last, { off: sum.off, inTune: sum.inTune, close: sum.close, judged: sum.judged, at: new Date().toISOString() });
      side.push(h('p', { class: 'kicker kicker--soft', text: t('result.notes') }),
        h('ol', { class: 'st-notes' }, ...targets.map((m, i) => noteCard(m, notes[i]))),
        shareRow(sum, notes, targets));
      ui.say(t('result.label') + '. ' + ui.short(sum.off) + '. ' + line);
    } else {
      const line = fmt(t('result.tooFew'), { judged: sum.judged, total: sum.total });
      card.append(h('p', { class: 'result-card__note', text: line }));
      ui.say(line);
    }
    const again = ui.button(t('result.again'), ui.start, 'btn--fill', null, icon(REDO));
    resV.replaceChildren(h('div', { class: 'st-result' }, card, side.length ? h('div', { class: 'st-side' }, ...side) : null),
      cta(), h('div', { class: 'stage__actions' }, h('div', { class: 'tool-panel__actions' }, again, other('tuner', '', icon(TUNE)))));
    ui.show(resV, again);
  }

  // The listening check: the piano only
  async function earRun() {
    const pairs = test && test.pairs ? test.pairs : earPairs(anyBand(ui.types), random(seed));
    const status = h('span', { text: c('loading') });
    const answer = h('p', { class: 'st-answer', text: BLANK });
    const higher = ui.button(t('ear.higher'), () => answerWith(true), 'btn-secondary btn--lg btn--strong', { disabled: true });
    const lower = ui.button(t('ear.lower'), () => answerWith(false), 'btn-secondary btn--lg btn--strong', { disabled: true });
    const again = ui.button(t('ear.again'), () => play(), 'btn-secondary', { disabled: true }, icon(REDO));
    const next = ui.button(c('next'), () => ask(i + 1), 'btn-primary', { hidden: true });
    const stop = ui.button(c('stop'), () => ui.halt(), 'btn-secondary', null, icon(STOP, 18, true));
    let i = 0;
    let right = 0;
    let timer = 0;
    view = {};
    runV.classList.remove('tool-panel__state--listening');
    runV.replaceChildren(h('div', { class: 'stage__head' }, h('p', { class: 'stage__status tool-panel__status' }, status)),
      h('div', { class: 'st-ear' }, h('p', { class: 'st-question', text: t('ear.question') }),
        h('div', { class: 'tool-panel__actions' }, higher, lower), answer),
      h('div', { class: 'stage__actions' }, h('div', { class: 'tool-panel__actions' }, again, next, stop)));
    ui.show(runV, stop);
    const bufs = await Promise.all(pairs.flatMap((p) => [p.a, p.b]).map((m) => E.piano.ensureNote(m)));
    if (gone()) return;
    if (bufs.some((b) => !b)) return ui.fail('pianoFailed');

    function play() {
      if (gone() || !ui.ctx) return;
      if (ui.ctx.state !== 'running') ui.ctx.resume().catch(() => {});
      const p = pairs[i];
      E.piano.stopAll();
      const t0 = E.piano.getContext().currentTime + 0.05;
      hook('piano', { midi: p.a, pair: i, up: p.up });
      E.piano.playNote(p.a, { when: t0, ringMs: 900 });
      E.piano.playNote(p.b, { when: t0 + 1, ringMs: 1300 });
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (gone() || !next.hidden) return;
        higher.disabled = lower.disabled = again.disabled = false;
        // A disabled button takes no focus: give it now, unless the reader went elsewhere
        const a = document.activeElement;
        if (!a || a === document.body || (ui.el.contains(a) && a !== again)) higher.focus({ preventScroll: true });
      }, 1050);
    }

    function ask(k) {
      if (gone()) return;
      if (k >= pairs.length) return earResult(right, pairs.length);
      i = k;
      status.textContent = fmt(t('ear.pairOf'), { n: k + 1, total: pairs.length });
      answer.textContent = BLANK;
      next.hidden = true;
      higher.disabled = lower.disabled = again.disabled = true;
      ui.say(status.textContent + '. ' + t('ear.question'));
      play();
    }

    function answerWith(up) {
      const p = pairs[i];
      if (up === p.up) right++;
      higher.disabled = lower.disabled = true;
      const step = fmt(plural(t('units.semitones'), p.step), { n: p.step });
      answer.textContent = fmt(t(p.up ? 'ear.wentUp' : 'ear.wentDown'), { step });
      ui.say(answer.textContent);
      next.hidden = false;
      next.focus({ preventScroll: true });
    }

    ask(0);
  }

  function earResult(right, total) {
    ui.halt(false);
    const again = ui.button(c('tryAgain'), ui.start, 'btn--fill', null, icon(REDO));
    resV.replaceChildren(h('div', { class: 'st-result' }, h('div', { class: 'result result-card' },
      h('p', { class: 'result-card__label', text: t('ear.label') }),
      h('p', { class: 'result-card__value', text: fmt(t('result.count'), { n: right, total }) }),
      h('p', { class: 'result-card__note', text: fmt(t('ear.score'), { right, total }) }),
      h('p', { class: 'result-card__note', text: t(right === total ? 'ear.all' : 'ear.some') }))),
    h('div', { class: 'stage__actions' }, h('div', { class: 'tool-panel__actions' }, again, other('sing', t('ear.toSing')))));
    ui.say(fmt(t('ear.score'), { right, total }));
    ui.show(resV, again);
  }

  return ui.mode === 'ear' ? earRun() : micRun();
}
