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
 * are pitch in cents and nothing else, never a verdict on the voice.
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
// (heldSpread). readings: believed {t, hz}, in order. Null if too little.
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

// The needle along the top and the trail under it, on one canvas, in the
// colours .pitch-trail sets
function scope(wrap, h) {
  const cv = h('canvas', { 'aria-hidden': 'true' });
  wrap.append(cv);
  const g = cv.getContext('2d');
  const css = getComputedStyle(wrap);
  const v = (n, d) => css.getPropertyValue(n).trim() || d;
  const col = {
    perfect: v('--trail-perfect', '#8AC4C7'), close: v('--trail-close', '#5A9FA3'), off: v('--trail-off', '#C4A87A'),
    band: v('--trail-target', 'rgba(90,159,163,.12)'), grid: v('--trail-grid', 'rgba(58,69,72,.7)'), text: v('--slate', '#7A8B91'),
  };
  const moving = v('--trail-motion', '1') !== '0';
  const tone = (c) => (Math.abs(c) <= IN_TUNE ? col.perfect : Math.abs(c) <= CLOSE ? col.close : col.off);
  const line = (x0, y0, x1, y1) => {
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
  };
  let pts = [];
  return {
    push: (t, y, c) => pts.push({ t, y, c }),
    clear: () => { pts = []; },
    // o: needle (cents or null), range (cents at the needle's ends), centre
    // (MIDI, fractional), span (semitones either side), target, label
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
      const cx = w / 2;
      const half = Math.min(w * 0.42, 220);
      const nx = (c) => cx + Math.max(-1, Math.min(1, c / o.range)) * half;
      g.fillStyle = col.band;
      g.fillRect(nx(-CLOSE), 10, nx(CLOSE) - nx(-CLOSE), 16);
      g.fillRect(nx(-IN_TUNE), 10, nx(IN_TUNE) - nx(-IN_TUNE), 16);
      g.strokeStyle = col.grid;
      g.lineWidth = 1;
      g.beginPath();
      line(cx - half, 18, cx + half, 18);
      for (const k of [-1, -0.5, 0, 0.5, 1]) line(cx + k * half, k ? 14 : 8, cx + k * half, k ? 22 : 28);
      g.stroke();
      if (o.needle != null) {
        g.strokeStyle = tone(o.needle);
        g.lineWidth = 3;
        g.beginPath();
        line(nx(o.needle), 6, nx(o.needle), 30);
        g.stroke();
      }
      const top = 44;
      const bot = ht - 10;
      const per = (bot - top) / (2 * o.span);
      const y = (m) => Math.max(top, Math.min(bot, (top + bot) / 2 - (m - o.centre) * per));
      g.lineWidth = 1;
      g.strokeStyle = col.grid;
      g.beginPath();
      for (let m = Math.ceil(o.centre - o.span); m <= o.centre + o.span; m++) line(0, y(m), w, y(m));
      g.stroke();
      if (o.target != null) {
        g.fillStyle = col.band;
        g.fillRect(0, y(o.target + CLOSE / 100), w, y(o.target - CLOSE / 100) - y(o.target + CLOSE / 100));
      }
      if (o.label) {
        g.fillStyle = col.text;
        g.font = '11px Sora, sans-serif';
        g.fillText(o.label, 6, y(o.target != null ? o.target : Math.round(o.centre)) - 6);
      }
      pts = pts.filter((p) => now - p.t <= WINDOW_S + 0.5);
      g.lineWidth = 3;
      g.lineCap = 'round';
      let prev = null;
      for (const p of moving ? pts : pts.slice(-1)) {
        const x = moving ? w - ((now - p.t) * w) / WINDOW_S : w - 14;
        const yy = y(p.y);
        if (prev && p.t - prev.t < 0.15 && Math.abs(p.y - prev.y) < 1.5) {
          g.strokeStyle = tone(p.c);
          g.beginPath();
          line(prev.x, prev.yy, x, yy);
          g.stroke();
        }
        prev = { t: p.t, y: p.y, c: p.c, x, yy };
      }
      if (prev && now - prev.t < 0.3) {
        g.fillStyle = tone(prev.c);
        g.beginPath();
        g.arc(prev.x, prev.yy, 4, 0, 7);
        g.fill();
      }
    },
  };
}

// One run, from the Start tap to its result. ui: what sing-in-tune-test.js
// keeps for the mount; my: this run's token; E: the engines.
export function begin(ui, my, E) {
  const { t, c, M, h, fmt, pd, test, el } = ui;
  const [, runV, resV] = ui.panes;
  const pr = new Intl.PluralRules(ui.lang);
  const plural = (o, n) => (o && (o[pr.select(n)] || o.other)) || '';
  const cents = (n) => fmt(plural(t('units.cents'), n), { n });
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
      onState: (s) => !gone() && runV.classList.toggle('tool-panel__state--listening', s === 'listening'),
    });
  }

  function paintHint() {
    const code = HINTS.find((k) => hints.has(k));
    if (view.hint) view.hint.textContent = code ? M[code] || '' : prompt;
    if (view.meter) view.meter.classList.toggle('level-meter--loud', hints.has('levelLoud'));
    if (!gone()) ui.hold();
  }

  function setPrompt(text, status) {
    prompt = text;
    if (status != null) view.status.textContent = status;
    paintHint();
  }

  function setBox(m) {
    if (view.boxMidi === m) return;
    view.boxMidi = m;
    const [l, i] = m == null ? [BLANK, BLANK] : ui.names(m);
    view.name.textContent = l;
    view.intl.textContent = l === i ? BLANK : i;
  }

  // The run pane for sing and tuner: status, note box, needle and trail,
  // readout, level meter, hint, actions
  function runPane(kind) {
    const wrap = h('div', { class: 'pitch-trail' });
    view = {
      kind,
      status: h('p', { class: 'tool-panel__status' }),
      name: h('span', { class: 'note-target__name' }),
      intl: h('span', { class: 'note-target__intl' }),
      readout: h('p', { text: BLANK }),
      meter: h('div', { class: 'level-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': t('meter') },
        h('span', { class: 'level-meter__fill' }), h('span', { class: 'level-meter__gate' })),
      hint: h('p', { class: 'tool-panel__hint' }),
      again: kind === 'sing' ? ui.button(t('sing.again'), () => capture && capture.end('again'), false, { disabled: true }) : null,
      smooth: 0, lockSince: null, voiceAt: -1, at: 0, said: 0, frozen: null,
    };
    view.box = h('div', { class: 'note-target' }, view.name, view.intl);
    setBox(null);
    const stop = ui.button(c('stop'), () => ui.halt(), false);
    runV.classList.remove('tool-panel__state--listening');
    runV.replaceChildren(view.status, view.box, wrap, view.readout, view.meter, view.hint,
      h('div', { class: 'tool-panel__actions' }, view.again, stop));
    view.meter.style.setProperty('--gate', E.pitch.GATE_LEVEL.toFixed(3));
    view.scope = scope(wrap, h);
    ui.show(runV, stop);
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
    const target = sing ? view.boxMidi : null;
    if (!sing && view.centre != null) view.centre += (view.goal - view.centre) * Math.min(1, dt * 4);
    view.scope.draw(now, {
      needle: view.frozen != null ? view.frozen : voiced ? view.smooth : null, range: sing ? 100 : 50,
      centre: sing ? (target == null ? 60 : target) : view.centre == null ? 60 : view.centre,
      span: sing ? 2 : 3, target, label: target == null ? '' : ui.names(target)[0],
    });
    if (view.frozen == null && ms - view.said > 250) {
      view.said = ms;
      view.readout.textContent = voiced ? offsetText(view.smooth) : BLANK;
    }
  }

  function reading(r) {
    const v = view;
    if (!v.meter) return;
    const lvl = E.pitch.meterLevel(r.rms);
    v.meter.style.setProperty('--level', lvl.toFixed(3));
    v.meter.setAttribute('aria-valuenow', String(Math.round(lvl * 100)));
    v.meter.classList.toggle('level-meter--ok', !r.gated);
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
    for (;;) {
      // The piano's turn: no microphone track is live
      view.again.disabled = true;
      setBox(midi);
      view.box.classList.remove('note-target--locked');
      view.scope.clear();
      view.voiceAt = -1;
      view.lockSince = view.frozen = null;
      view.readout.textContent = BLANK;
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
      setPrompt(text);
      view.frozen = m ? m.cents : null;
      view.readout.textContent = m ? ui.short(round(m.cents), true) : BLANK;
      ui.say(m ? fmt(t('sing.measured'), { n: i + 1, offset: text }) : text);
      await sleep(PAUSE_MS);
      return gone() ? null : m;
    }
  }

  // Back to the panel in another mode: a chip, so it shares a line with the main action
  function other(mode, text) {
    return h('button', {
      type: 'button', class: 'chip', text: text || t('modes.' + mode),
      onclick: () => {
        ui.mode = mode;
        ui.showIdle(true);
      },
    });
  }

  function facts(rows) {
    return h('dl', { class: 'result-card__facts' }, ...rows.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))));
  }

  function cta() {
    const android = /Android/i.test((globalThis.navigator && navigator.userAgent) || '');
    return h('div', {}, h('p', { class: 'result-card__note', text: t('result.ctaBody') }),
      android && pd.playLink
        ? h('p', { class: 'tool-panel__actions' }, h('a', { class: 'btn btn-primary', href: pd.playLink, rel: 'noopener', text: t('result.ctaButton') }))
        : h('p', { class: 'result-card__note', text: pd.androidOnlyLine || '' }));
  }

  function result(sum, notes, targets) {
    ui.halt(false);
    const last = ui.load(ui.keys.last);
    const card = h('div', { class: 'result-card' }, h('p', { class: 'result-card__label', text: t('result.label') }));
    const count = (n) => fmt(t('result.count'), { n, total: sum.judged });
    if (sum.enough) {
      // "further than 0 cents" only a test tone earns: the figure says it alone
      const line = [sum.off ? fmt(t('result.offSay'), { cents: cents(sum.off) }) : '',
        sum.lean == null ? '' : t(sum.lean > 0 ? 'result.offHigh' : 'result.offLow')].filter(Boolean).join(' ');
      card.append(
        h('p', { class: 'result-card__value' }, ui.short(sum.off) + ' ', h('small', { text: fmt(t('result.basis'), { judged: sum.judged, total: sum.total }) })),
        line ? h('p', { class: 'result-card__note', text: line }) : '', // append() prints a null as text
        facts([[t('result.within10'), count(sum.inTune)], [t('result.within25'), count(sum.close)],
          ...(sum.wobble == null ? [] : [[t('result.wobble'), ui.short(sum.wobble)]])]),
        // The detail on demand: the result fits where the run was
        h('details', {}, h('summary', { class: 'result-card__label', text: t('result.notes') }),
          facts(targets.map((m, i) => {
            const n = notes[i];
            const v = n ? ui.short(round(n.cents), true) : t('sing.notHeard');
            return [ui.label(m), n && n.octave ? fmt(t(n.octave > 0 ? 'offset.octaveUp' : 'offset.octaveDown'), { offset: v }) : v];
          })),
          h('p', { class: 'result-card__note', text: sum.wobble == null ? t('result.wobbleNone')
            : (sum.wobble ? fmt(t('result.wobbleSay'), { cents: cents(sum.wobble) }) + ' ' : '') + t('result.wobbleRead') }),
          h('p', { class: 'result-card__note', text: t('result.cent') + ' ' + t('result.sample') })));
      const before = ui.lastLine(last);
      if (before) card.append(h('p', { class: 'result-card__note', text: before }));
      ui.store(ui.keys.last, { off: sum.off, inTune: sum.inTune, close: sum.close, judged: sum.judged, at: new Date().toISOString() });
      ui.say(t('result.label') + ': ' + ui.short(sum.off) + '. ' + line);
    } else {
      const line = fmt(t('result.tooFew'), { judged: sum.judged, total: sum.total });
      card.append(h('p', { class: 'result-card__note', text: line }));
      ui.say(line);
    }
    const again = ui.button(t('result.again'), ui.start, true);
    resV.replaceChildren(card, h('div', { class: 'tool-panel__actions' }, again, other('tuner')), cta());
    ui.show(resV, again);
  }

  // The listening check: the piano only
  async function earRun() {
    const pairs = test && test.pairs ? test.pairs : earPairs(anyBand(ui.types), random(seed));
    const status = h('p', { class: 'tool-panel__status', text: c('loading') });
    const answer = h('p', { class: 'tool-panel__hint' });
    const higher = ui.button(t('ear.higher'), () => answerWith(true), true, { disabled: true });
    const lower = ui.button(t('ear.lower'), () => answerWith(false), true, { disabled: true });
    const again = ui.button(t('ear.again'), () => play(), false, { disabled: true });
    const next = ui.button(c('next'), () => ask(i + 1), true, { hidden: true });
    const stop = ui.button(c('stop'), () => ui.halt(), false);
    let i = 0;
    let right = 0;
    let timer = 0;
    view = {};
    runV.classList.remove('tool-panel__state--listening');
    runV.replaceChildren(status, h('p', { text: t('ear.question') }), h('div', { class: 'tool-panel__actions' }, higher, lower),
      answer, h('div', { class: 'tool-panel__actions' }, again, next, stop));
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
        if (!a || a === document.body || (el.contains(a) && a !== again)) higher.focus({ preventScroll: true });
      }, 1050);
    }

    function ask(k) {
      if (gone()) return;
      if (k >= pairs.length) return earResult(right, pairs.length);
      i = k;
      status.textContent = fmt(t('ear.pairOf'), { n: k + 1, total: pairs.length });
      answer.textContent = '';
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
    const again = ui.button(c('tryAgain'), ui.start, true);
    resV.replaceChildren(
      h('div', { class: 'result-card' }, h('p', { class: 'result-card__label', text: t('ear.label') }),
        h('p', { class: 'result-card__value', text: fmt(t('result.count'), { n: right, total }) }),
        h('p', { class: 'result-card__note', text: fmt(t('ear.score'), { right, total }) }),
        h('p', { class: 'result-card__note', text: t(right === total ? 'ear.all' : 'ear.some') })),
      h('div', { class: 'tool-panel__actions' }, again, other('sing', t('ear.toSing'))));
    ui.say(fmt(t('ear.score'), { right, total }));
    ui.show(resV, again);
  }

  return ui.mode === 'ear' ? earRun() : micRun();
}
