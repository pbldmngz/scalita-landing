/*
 * scheduler.js: what the app plays for a routine or a scale, in its order,
 * on the audio clock.
 *
 * Ported one to one from scalita_app lib/core/audio/:
 *   transposition_plan.dart   transpositionRoots, patternSpan, patternDepth
 *   comfort_anchor.dart       comfortableStartMidi, comfortSpanWindow
 *   passaggio_range.dart      passaggioRange
 *   step_range.dart           resolveStepRange, registers and seams included
 *   transposition_engine.dart, playback_engine.dart, note_timing.dart: the
 *     sequence compile() writes. A key is its cue chord and a beat (not on a
 *     routine's very first key), the pattern repeatCount times with a beat
 *     between runs, then, if a key follows: the current key's chord and a
 *     beat (up to 160 bpm), the breathe gap if set, the next key's chord and
 *     a beat. Between routine steps the pause (3 s). A count-in of three
 *     seconds opens it, as the app's does.
 *   routine_duration.dart     estimateSeconds, estimateMinutes
 * tool/tests/scheduler holds every function to the app's exported vectors.
 *
 * stepsFor(entry, voice, registers) -> steps: a player entry (page data) for
 *   a voice, {preset, low, high, primo, secondo}.
 * compile(steps, opts) -> {events, durationMs, countInMs, low, high}, pure.
 * play() lives in scheduler-play.js, loaded with piano.js on the first Play,
 *   so a page carries only what it needs before a tap (the 15 KB budget).
 */

export const REST = -1000;
export const MIDI_MIN = 21;
export const MIDI_MAX = 108;
export const MAX_CURRENT_CUE_BPM = 160;
export const CLEAR_FADE_MS = 60;
export const COUNT_IN = 3;
export const PAUSE_BETWEEN_MS = 3000;
export const DEFAULT_TEMPO = 72;
// VocalRegister.defaultSpan, for a page data without registers
export const REGISTER_DEFAULTS = {
  subharmonic: { low: 33, high: 41 },
  flageolet: { low: 79, high: 88 },
  whistle: { low: 89, high: 96 },
};

const SETTLE_STEP = 2;
const PASSAGGIO_CLEARANCE = 5;
const MAX_SEAM_GAP = 12;
// How far past the playback range a passaggio step may reach, either side
// (passaggio_range.dart passaggioRangeAllowance, BACKLOG 62c)
const PASSAGGIO_RANGE_ALLOWANCE = 2;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const idiv = (a, b) => Math.trunc(a / b); // Dart's ~/
const mod12 = (x) => ((x % 12) + 12) % 12; // Dart's % on an int
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// ---------------------------------------------------------------- the sweep

export function patternSpan(intervals) {
  let lo = 0;
  let hi = 0;
  for (const i of intervals) {
    if (i === REST) continue;
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  return hi - lo;
}

export function patternDepth(intervals) {
  let lo = 0;
  for (const i of intervals) if (i !== REST && i < lo) lo = i;
  return 0 - lo;
}

export function transpositionRoots({
  startMidi,
  endMidi,
  maxInterval,
  semitoneStep,
  comfortMidi = null,
  returnToComfort = false,
  settleFromMidi = null,
  depth = 0,
}) {
  const step = semitoneStep >= 1 ? semitoneStep : 1; // the Dart loops forever on less
  const highestRoot = endMidi - maxInterval;
  const anchor = isNum(comfortMidi)
    ? clamp(comfortMidi, startMidi, highestRoot < startMidi ? startMidi : highestRoot)
    : null;
  const useComfort = anchor !== null && anchor > startMidi && anchor <= highestRoot;
  const roots = [];
  for (let r = useComfort ? anchor : startMidi; r <= highestRoot; r += step) roots.push(r);
  if (useComfort) {
    const top = roots.length ? roots[roots.length - 1] : anchor;
    const settleStep = step > SETTLE_STEP ? step : SETTLE_STEP;
    const settle = isNum(settleFromMidi) ? settleFromMidi : null;
    for (let r = top - step; r >= startMidi; ) {
      roots.push(r);
      r -= settle !== null && r <= settle ? settleStep : step;
    }
    if (settle !== null && roots.length && roots[roots.length - 1] > startMidi) roots.push(startMidi);
    if (returnToComfort && roots.length && roots[roots.length - 1] < anchor) {
      for (let r = roots[roots.length - 1] + step; r <= anchor; r += step) roots.push(r);
    }
  }
  if (!roots.length && startMidi + maxInterval <= MIDI_MAX) roots.push(startMidi);
  return roots.map((r) => r + depth);
}

// ---------------------------------------------------------------- the range

export function comfortableStartMidi({ rangeLow, rangeHigh, scaleSpan, primoPassaggio = null }) {
  const anchor = isNum(primoPassaggio)
    ? primoPassaggio - scaleSpan - PASSAGGIO_CLEARANCE
    : rangeLow + idiv(rangeHigh - rangeLow, 4);
  const highestUsableRoot = rangeHigh - scaleSpan;
  if (highestUsableRoot <= rangeLow) return rangeLow;
  return clamp(clamp(anchor, rangeLow, highestUsableRoot), MIDI_MIN, MIDI_MAX);
}

export function comfortSpanWindow({ comfortMidi, semitoneSpan, scaleSpan, rangeLow, rangeHigh }) {
  const rootCount = clamp(semitoneSpan - scaleSpan + 1, 1, 1 << 20);
  const lowestRoot = rangeLow;
  const highestRoot = rangeHigh - scaleSpan;
  if (highestRoot <= lowestRoot) {
    return { startMidi: lowestRoot, endMidi: lowestRoot + scaleSpan, anchorMidi: lowestRoot };
  }
  const available = highestRoot - lowestRoot + 1;
  const keys = rootCount > available ? available : rootCount;
  let start = comfortMidi - idiv(keys - 1, 3);
  if (start < lowestRoot) start = lowestRoot;
  if (start + keys - 1 > highestRoot) start = highestRoot - keys + 1;
  const end = start + keys - 1;
  return { startMidi: start, endMidi: end + scaleSpan, anchorMidi: clamp(comfortMidi, start, end) };
}

export function passaggioRange({ intent, primo, secondo, scaleSpan, rangeLow, rangeHigh }) {
  let start;
  let end;
  switch (intent) {
    case 'approachOnly':
      start = primo - scaleSpan - 6;
      end = primo - 1;
      break;
    case 'crossOnce':
      start = primo - scaleSpan - 3;
      end = secondo + 3;
      break;
    case 'targetZona': {
      const centre = idiv(primo + secondo, 2);
      start = centre - 6 - scaleSpan;
      end = centre + 6;
      break;
    }
    case 'fullJourney':
      start = primo - scaleSpan - 8;
      end = secondo + scaleSpan + 4;
      break;
    default:
      return { startMidi: rangeLow, endMidi: rangeHigh };
  }
  // Within the singer's reach, a little either side of it; where not one key
  // of the pattern fits, the one key nearest the bounds
  const lowBound = rangeLow - PASSAGGIO_RANGE_ALLOWANCE;
  const highBound = rangeHigh + PASSAGGIO_RANGE_ALLOWANCE;
  start = Math.max(start, lowBound);
  end = Math.min(end, highBound);
  if (end - start < scaleSpan) {
    start = clamp(start, lowBound, Math.max(lowBound, highBound - scaleSpan));
    end = start + scaleSpan;
  }
  start = clamp(start, MIDI_MIN, MIDI_MAX - scaleSpan);
  end = clamp(end, start + scaleSpan, MIDI_MAX);
  return { startMidi: start, endMidi: end };
}

function mirrorSeam(boundary, top, floor) {
  const lo = Math.max(boundary - (top - boundary), Math.max(floor, MIDI_MIN));
  if (lo >= boundary) return null;
  return { lo, hi: Math.min(top, MIDI_MAX) };
}

export function flageoletSeam({ rangeHigh, rangeLow, flageolet, secondo }) {
  if (!isNum(rangeHigh)) return null;
  if (flageolet.high <= rangeHigh) return null;
  if (flageolet.low - rangeHigh > MAX_SEAM_GAP) return null;
  return mirrorSeam(
    Math.max(rangeHigh, flageolet.low),
    flageolet.high,
    Math.max(isNum(secondo) ? secondo : MIDI_MIN, isNum(rangeLow) ? rangeLow : MIDI_MIN),
  );
}

export function whistleSeam({ flageolet, whistle }) {
  if (!flageolet) return null;
  if (whistle.high <= flageolet.high) return null;
  if (whistle.low - flageolet.high > MAX_SEAM_GAP) return null;
  return mirrorSeam(Math.max(flageolet.high, whistle.low), whistle.high, flageolet.low);
}

// StepRangeContext.fromSettings for a singer with no declared register spans
// and challenge range off: the presets' singer and the site's custom range
export function singer({ low, high, primo = null, secondo = null, semitoneStep = 1, comfortFirst = true, registers = null } = {}) {
  const spans = {};
  for (const r of registers || []) if (r && r.id) spans[r.id] = { low: r.low, high: r.high };
  return {
    rangeLow: low,
    rangeHigh: high,
    widenedLow: low,
    widenedHigh: high,
    mainHigh: Math.min(high, clamp(high, MIDI_MIN, MIDI_MAX)),
    semitoneStep,
    comfortFirst,
    primo: isNum(primo) ? primo : null,
    secondo: isNum(secondo) ? secondo : null,
    declared: {},
    defaults: { ...REGISTER_DEFAULTS, ...spans },
    up: 0,
    down: 0,
  };
}

const comfortNote = (c, span) =>
  comfortableStartMidi({ rangeLow: c.widenedLow, rangeHigh: c.mainHigh, scaleSpan: span, primoPassaggio: c.primo });

// One routine step as routines.json writes it: span (semitoneSpan),
// useVocalRange, semitoneStep, register, anchorHigh, passaggioIntent
export function resolveStepRange(step, intervals, c) {
  const span = patternSpan(intervals);
  const useVocalRange = step.useVocalRange !== false;
  const fixed = isNum(step.span) ? step.span : null;
  const semitoneStep = isNum(step.semitoneStep) ? step.semitoneStep : c.semitoneStep;
  if (step.register) return registerRange(step, useVocalRange, fixed, span, semitoneStep, c);
  let start = c.widenedLow;
  let end = c.widenedHigh;
  let comfort = c.comfortFirst ? comfortNote(c, span) : null;
  if (!useVocalRange && fixed !== null) {
    if (step.anchorHigh) {
      end = c.widenedHigh;
      start = Math.max(c.widenedLow, end - fixed);
      comfort = end - span;
    } else if (comfort !== null) {
      const w = comfortSpanWindow({
        comfortMidi: comfort,
        semitoneSpan: fixed,
        scaleSpan: span,
        rangeLow: c.widenedLow,
        rangeHigh: c.widenedHigh,
      });
      start = w.startMidi;
      end = w.endMidi;
      comfort = w.anchorMidi;
    } else {
      end = start + fixed;
    }
  }
  const intent = step.passaggioIntent || 'none';
  if (intent !== 'none' && c.primo !== null && c.secondo !== null) {
    const r = passaggioRange({ intent, primo: c.primo, secondo: c.secondo, scaleSpan: span, rangeLow: c.widenedLow, rangeHigh: c.widenedHigh });
    start = r.startMidi;
    end = r.endMidi;
    comfort = null;
  }
  return { startMidi: start, endMidi: end, semitoneStep, comfortMidi: comfort, span, returnToComfort: false, settleFromMidi: null };
}

function registerRange(step, useVocalRange, fixed, span, semitoneStep, c) {
  const reg = step.register;
  const raw = c.declared[reg] || c.defaults[reg] || REGISTER_DEFAULTS[reg];
  const windowLow = clamp(raw.low - c.down, MIDI_MIN, MIDI_MAX);
  const windowHigh = clamp(raw.high + c.up, MIDI_MIN, MIDI_MAX);
  let start = windowLow;
  let end = windowHigh;
  let effectiveStep = semitoneStep;
  const isBridge = useVocalRange && (reg === 'flageolet' || reg === 'whistle');
  if (isBridge) {
    const seam = reg === 'flageolet'
      ? flageoletSeam({ rangeHigh: c.rangeHigh, rangeLow: c.rangeLow, flageolet: raw, secondo: c.secondo })
      : whistleSeam({ flageolet: c.declared.flageolet || null, whistle: raw });
    if (seam) {
      start = seam.lo;
      end = windowHigh;
    }
  } else if (fixed !== null) {
    if (step.anchorHigh) start = Math.max(windowLow, windowHigh - fixed);
    else end = Math.min(windowLow + fixed, windowHigh);
  }
  if (isBridge) {
    const climb = end - span - start;
    if (climb > 24) effectiveStep = Math.max(effectiveStep, idiv(climb + 23, 24));
  }
  if (end - span < start) start = Math.max(MIDI_MIN, end - span);
  let settleFromMidi = null;
  if (isBridge && step.anchorHigh) {
    const comfort = comfortNote(c, span);
    const target = c.primo === null ? comfort : Math.max(comfort, c.primo - 1 - span);
    if (target < start) {
      settleFromMidi = start;
      start = target;
    }
  }
  const anchor = isBridge
    ? (step.anchorHigh ? end - span : null)
    : step.anchorHigh
      ? end - span
      : start + idiv(end - span - start, 3);
  return {
    startMidi: start,
    endMidi: end,
    semitoneStep: effectiveStep,
    comfortMidi: anchor,
    span,
    returnToComfort: !isBridge && !step.anchorHigh,
    settleFromMidi,
  };
}

// What one routine step plays for singer c: its range, roots and repeats
export function stepPlan(step, intervals, c) {
  const range = resolveStepRange(step, intervals, c);
  const depth = patternDepth(intervals);
  const roots = transpositionRoots({
    startMidi: range.startMidi,
    endMidi: range.endMidi,
    maxInterval: patternSpan(intervals),
    semitoneStep: range.semitoneStep,
    comfortMidi: range.comfortMidi,
    returnToComfort: range.returnToComfort,
    settleFromMidi: range.settleFromMidi,
    depth,
  });
  return { range: { ...range, depth }, roots, repeatCount: Math.max(1, step.repeatCount || 1) };
}

// The single scale player's sweep (player_screen.dart): the singer's range,
// the comfort note under the main range's top, one run a key
export function scaleSweep(intervals, c) {
  const span = patternSpan(intervals);
  const start = c.widenedLow;
  const end = c.widenedHigh;
  const comfort = c.comfortFirst
    ? comfortableStartMidi({ rangeLow: start, rangeHigh: Math.min(end, c.mainHigh), scaleSpan: span, primoPassaggio: c.primo })
    : null;
  const depth = patternDepth(intervals);
  const roots = transpositionRoots({ startMidi: start, endMidi: end, maxInterval: span, semitoneStep: c.semitoneStep, comfortMidi: comfort, depth });
  return { startMidi: start, endMidi: end, comfortMidi: comfort, semitoneStep: c.semitoneStep, span, depth, returnToComfort: false, settleFromMidi: null, roots };
}

// The steps a player entry (page data players[key]) plays for voice
// {preset, low, high, primo, secondo}: the export's own roots for a preset
// when it has them, the port otherwise
export function stepsFor(entry, voice, registers = null) {
  const c = singer({ ...voice, registers });
  const pre = voice.preset && entry.presets ? entry.presets[voice.preset] : null;
  if (entry.kind === 'scale') {
    const intervals = entry.intervals || [0, 12];
    const roots = pre && Array.isArray(pre.roots) ? pre.roots : scaleSweep(intervals, c).roots;
    const any = entry.presets ? Object.values(entry.presets)[0] : null;
    return [{
      scaleId: entry.id,
      intervals,
      beats: entry.beats || null,
      tempo: (pre && pre.tempo) || (any && any.tempo) || entry.tempo || DEFAULT_TEMPO,
      direction: (pre && pre.direction) || entry.naturalDirection || 'normal',
      repeatCount: 1,
      roots,
      cueOffset: entry.cueOffset || 0,
    }];
  }
  return (entry.steps || []).map((st, i) => {
    const sc = (entry.scales && entry.scales[st.scaleId]) || {};
    const intervals = sc.intervals || [0, 12];
    const own = pre && Array.isArray(pre.roots) ? pre.roots[i] : null;
    return {
      scaleId: st.scaleId,
      intervals,
      beats: sc.beats || null,
      tempo: st.tempo,
      direction: st.direction || 'normal',
      repeatCount: Math.max(1, st.repeatCount || 1),
      roots: Array.isArray(own) ? own : stepPlan(st, intervals, c).roots,
      cueOffset: sc.cueOffset || 0,
    };
  });
}

// ---------------------------------------------------------------- the cues

export const playsCurrentCue = (bpm) => bpm <= MAX_CURRENT_CUE_BPM;
export const cueVolumeFor = (lowest) => (lowest >= 84 ? 0.4 : 0.8);
export const isCueChordTone = (interval, minor = false) => [0, minor ? 3 : 4, 7].includes(mod12(interval));

export function cueChordNotes(root, minor = false) {
  const third = minor ? 3 : 4;
  return root > 96 ? [root, root - (12 - third), root - 5] : [root, root + third, root + 7];
}

export const fromCueRoot = (intervals, offset) => intervals.map((i) => (i === REST ? i : mod12(i - offset)));

export function isMinorPattern(intervals) {
  const pcs = new Set(intervals.filter((i) => i !== REST).map(mod12));
  return pcs.has(3) && !pcs.has(4);
}

// ---------------------------------------------------------------- the notes

export function runOrder(list, direction) {
  if (direction === 'inverted') return [...list].reverse();
  if (direction === 'mirror') return [...list, ...[...list].reverse().slice(1)];
  return [...list];
}

export function beatsFor(intervals, beats, direction) {
  const ok = Array.isArray(beats) && beats.length === intervals.length && beats.every((b) => b > 0);
  return runOrder(ok ? beats : intervals.map(() => 1), direction);
}

function lastSounded(run) {
  for (let i = run.length - 1; i >= 0; i--) if (run[i] !== REST) return run[i];
  return null;
}

// estimateRoutineDuration with the routine screen's arguments, in whole
// seconds; the operations in the Dart's order, so the rounding agrees
export function estimateSeconds(steps, { pauseBetweenSeconds = PAUSE_BETWEEN_MS / 1000, pauseAfterKeyMs = 0, tempoMultiplier = 1 } = {}) {
  let total = 0;
  let keysAll = 0;
  for (const s of steps) {
    const beatsPerRun = beatsFor(s.intervals, s.beats, s.direction).reduce((a, b) => a + b, 0);
    const tempo = s.tempo * tempoMultiplier;
    const spn = 60 / tempo;
    const keys = s.roots.length;
    const reps = Math.max(1, s.repeatCount || 1);
    keysAll += keys;
    total += beatsPerRun * spn * (keys * reps);
    total += spn * (keys * (reps - 1));
    total += spn * keys;
    if (keys > 1) total += spn * (playsCurrentCue(tempo) ? 1 : 0) * (keys - 1);
    if (pauseAfterKeyMs > 0 && keys > 1) total += (pauseAfterKeyMs / 1000) * (keys - 1);
  }
  if (steps.length && keysAll > 0) total -= 60 / (steps[0].tempo * tempoMultiplier);
  for (let i = 0; i < steps.length - 1; i++) total += pauseBetweenSeconds;
  return Math.round(total);
}

export const estimateMinutes = (steps, opts) => clamp(Math.ceil(estimateSeconds(steps, opts) / 60), 1, 999);

// ---------------------------------------------------------------- compile

// Every event at its time t in ms from the start, in order: count {n},
// step {step, steps, keys}, chord {role: start|current|next, root, notes,
// bpm, capMs, volume}, key {step, key, keys, root}, note {midi, durMs},
// rest {durMs}, gap {kind: repeat|breathe, ms}, fade {fadeMs}, pause
// {left: seconds}, end. low and high bound every pitch it sounds.
export function compile(steps, {
  skipFirstChord = false,
  countIn = COUNT_IN,
  countInMs = 1000,
  pauseBetweenMs = PAUSE_BETWEEN_MS,
  pauseAfterKeyMs = 0,
  tempoMultiplier = 1,
} = {}) {
  const events = [];
  let t = 0;
  let low = Infinity;
  let high = -Infinity;
  const add = (e) => {
    e.t = t;
    events.push(e);
  };
  const mark = (m) => {
    if (m < low) low = m;
    if (m > high) high = m;
  };
  for (let n = countIn; n >= 1; n--) {
    add({ type: 'count', n });
    t += countInMs;
  }
  const start = t;
  steps.forEach((s, si) => {
    const bpm = s.tempo * tempoMultiplier;
    const eff = Math.round(bpm);
    const beat = Math.round(60000 / bpm);
    const noteMs = Math.round(60000 / eff);
    const run = runOrder(s.intervals, s.direction);
    const lens = beatsFor(s.intervals, s.beats, s.direction).map((b) => Math.round(noteMs * b));
    const cue = s.cueOffset || 0;
    const minor = isMinorPattern(fromCueRoot(s.intervals, cue));
    const last = lastSounded(run);
    const endsOnChordTone = last === null || isCueChordTone(last - cue, minor);
    const roots = s.roots || [];
    const reps = Math.max(1, s.repeatCount || 1);
    const chord = (role, root, capMs = null) => {
      const notes = cueChordNotes(root + cue, minor);
      notes.forEach(mark);
      add({ type: 'chord', step: si, role, root: root + cue, notes, bpm: eff, capMs, volume: cueVolumeFor(Math.min(...notes)) });
    };
    // A step starts with the engine's stop(): whatever rings, faded
    if (si > 0) add({ type: 'fade', fadeMs: CLEAR_FADE_MS });
    add({ type: 'step', step: si, steps: steps.length, keys: roots.length });
    roots.forEach((root, k) => {
      if (k === 0 && !(skipFirstChord && si === 0)) {
        chord('start', root);
        t += beat;
      }
      add({ type: 'key', step: si, key: k, keys: roots.length, root });
      for (let r = 0; r < reps; r++) {
        if (r > 0) {
          add({ type: 'gap', kind: 'repeat', step: si, ms: beat });
          t += beat;
        }
        run.forEach((iv, i) => {
          const midi = root + iv;
          if (midi < 0) {
            add({ type: 'rest', step: si, key: k, index: i, durMs: lens[i] });
          } else {
            mark(midi);
            add({ type: 'note', step: si, key: k, index: i, midi, durMs: lens[i] });
          }
          t += lens[i];
        });
      }
      if (k < roots.length - 1) {
        if (playsCurrentCue(bpm)) {
          if (!endsOnChordTone) add({ type: 'fade', fadeMs: CLEAR_FADE_MS });
          chord('current', root, beat + pauseAfterKeyMs - 40);
          t += beat;
        }
        if (pauseAfterKeyMs > 0) {
          add({ type: 'gap', kind: 'breathe', step: si, ms: pauseAfterKeyMs });
          t += pauseAfterKeyMs;
        }
        add({ type: 'fade', fadeMs: CLEAR_FADE_MS });
        chord('next', roots[k + 1]);
        t += beat;
      }
    });
    if (si < steps.length - 1 && pauseBetweenMs > 0) {
      const secs = Math.ceil(pauseBetweenMs / 1000);
      for (let j = 0; j < secs; j++) events.push({ type: 'pause', step: si, left: secs - j, t: t + j * 1000 });
      t += pauseBetweenMs;
    }
  });
  add({ type: 'end' });
  return { events, durationMs: t - start, countInMs: start, low: low === Infinity ? null : low, high: high === -Infinity ? null : high };
}
