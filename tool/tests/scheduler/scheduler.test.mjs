// js/audio/scheduler.js held to the app's own exported vectors and presets.
//
//   node --test tool/tests/scheduler/
//
// transposition_vectors.json: 200 cases of transpositionRoots(), exact.
// step_range_vectors.json: 300 custom ranges through resolveStepRange and
// the single scale player's sweep, range and roots exact.
// routines.json and scales.json presets: every voice type, recomputed by the
// port, and the routine durations from the ported estimator, exact.
// Then the sequence compile() writes and how play() schedules it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../../js/audio/scheduler.js';
import { ringForNote, ringTimeMsForBpm } from '../../../js/audio/piano.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = (f) => JSON.parse(readFileSync(join(here, '..', '..', 'data', 'app', f), 'utf8'));
const TV = app('transposition_vectors.json');
const SV = app('step_range_vectors.json');
const ROUTINES = app('routines.json');
const SCALES = app('scales.json');
const VOICES = app('voice_types.json');
const REGISTERS = app('registers.json');
const scaleById = Object.fromEntries(SCALES.map((s) => [s.id, s]));
const routineById = Object.fromEntries(ROUTINES.map((r) => [r.id, r]));

// A routine as the page data carries it: steps plus the scales they use
const entryOf = (r) => ({
  kind: 'routine',
  ...r,
  scales: Object.fromEntries(r.steps.map((s) => [s.scaleId, scaleById[s.scaleId]])),
});
const presetVoice = (v) => ({ low: v.presetLow, high: v.presetHigh, primo: v.primo, secondo: v.secondo });

test('transpositionRoots matches all 200 app vectors exactly', () => {
  assert.equal(TV.length, 200);
  let bad = 0;
  for (const [n, v] of TV.entries()) {
    const got = S.transpositionRoots(v.input);
    if (JSON.stringify(got) !== JSON.stringify(v.roots)) {
      bad++;
      assert.fail(`case ${n} ${JSON.stringify(v.input)}: ${JSON.stringify(got)} is not ${JSON.stringify(v.roots)}`);
    }
  }
  assert.equal(bad, 0);
});

test('every routine step uses one of the exported scales', () => {
  for (const r of ROUTINES) for (const s of r.steps) assert.ok(scaleById[s.scaleId], `${r.id}: ${s.scaleId}`);
});

test('custom ranges: all 300 step range vectors, range and roots exact', () => {
  assert.equal(SV.length, 300);
  for (const [n, v] of SV.entries()) {
    const inp = v.input;
    const c = S.singer({ low: inp.rangeLow, high: inp.rangeHigh, primo: inp.primo, secondo: inp.secondo, registers: REGISTERS });
    const where = `case ${n} ${JSON.stringify(inp)}`;
    if (inp.kind === 'scale') {
      const sw = S.scaleSweep(scaleById[inp.scaleId].intervals, c);
      const { roots, ...range } = sw;
      assert.deepEqual(range, v.range, where);
      assert.deepEqual(roots, v.roots, where);
      assert.equal(v.repeatCount, 1, where);
    } else {
      const step = routineById[inp.routineId].steps[inp.stepIndex];
      const plan = S.stepPlan(step, scaleById[step.scaleId].intervals, c);
      assert.deepEqual(plan.range, v.range, where);
      assert.deepEqual(plan.roots, v.roots, where);
      assert.equal(plan.repeatCount, v.repeatCount, where);
      assert.equal(step.tempo, v.tempo, where);
      assert.equal(step.direction, v.direction, where);
    }
  }
});

test('routine presets: the port gives every step root of every voice type', () => {
  let steps = 0;
  for (const r of ROUTINES) {
    for (const v of VOICES) {
      const got = S.stepsFor(entryOf({ ...r, presets: {} }), presetVoice(v), REGISTERS);
      const want = r.presets[v.id].roots;
      assert.equal(got.length, want.length, `${r.id} ${v.id}`);
      got.forEach((s, i) => assert.deepEqual(s.roots, want[i], `${r.id} ${v.id} step ${i}`));
      steps += got.length;
    }
  }
  assert.ok(steps > 500);
});

test('routine presets: duration and minutes from the ported estimator, exact', () => {
  for (const r of ROUTINES) {
    for (const v of VOICES) {
      const p = r.presets[v.id];
      const steps = S.stepsFor(entryOf(r), { preset: v.id, ...presetVoice(v) }, REGISTERS);
      assert.equal(S.estimateSeconds(steps) * 1000, p.durationMs, `${r.id} ${v.id}`);
      assert.equal(S.estimateMinutes(steps), p.minutes, `${r.id} ${v.id}`);
    }
  }
});

test('scale presets: the port gives the single scale player sweep for every voice type', () => {
  for (const s of SCALES) {
    for (const v of VOICES) {
      const p = s.presets[v.id];
      const sw = S.scaleSweep(s.intervals, S.singer(presetVoice(v)));
      for (const k of ['startMidi', 'endMidi', 'comfortMidi', 'semitoneStep', 'span', 'depth', 'roots']) {
        assert.deepEqual(sw[k], p[k], `${s.id} ${v.id} ${k}`);
      }
      const [step] = S.stepsFor({ kind: 'scale', ...s, presets: {} }, presetVoice(v));
      assert.deepEqual(step.roots, p.roots);
      assert.equal(step.tempo, p.tempo);
      assert.equal(step.direction, p.direction);
    }
  }
});

test('stepsFor uses the preset roots it is given', () => {
  const r = routineById.pre_performance;
  const steps = S.stepsFor(entryOf(r), { preset: 'tenor', low: 0, high: 0 });
  assert.deepEqual(steps.map((s) => s.roots), r.presets.tenor.roots);
});

// ------------------------------------------------------------------ compile

const tenor = VOICES.find((v) => v.id === 'tenor');
const preSteps = S.stepsFor(entryOf(routineById.pre_performance), { preset: 'tenor', ...presetVoice(tenor) }, REGISTERS);
const pre = S.compile(preSteps, { skipFirstChord: true });
const ofType = (tl, type) => tl.events.filter((e) => e.type === type);

test('compile: count-in, then the first key without its chord', () => {
  const ev = pre.events;
  assert.deepEqual(ev.slice(0, 3).map((e) => [e.type, e.n, e.t]), [['count', 3, 0], ['count', 2, 1000], ['count', 1, 2000]]);
  assert.equal(pre.countInMs, 3000);
  assert.deepEqual([ev[3].type, ev[3].t], ['step', 3000]);
  assert.deepEqual([ev[4].type, ev[4].t, ev[4].root], ['key', 3000, preSteps[0].roots[0]]);
  assert.equal(ev[5].type, 'note');
});

test('compile: the keys in order are the preset roots', () => {
  const keys = ofType(pre, 'key').map((e) => [e.step, e.root]);
  const want = preSteps.flatMap((s, i) => s.roots.map((r) => [i, r]));
  assert.deepEqual(keys, want);
});

test('compile: events are in time order and the notes are the pattern on each key', () => {
  for (let i = 1; i < pre.events.length; i++) assert.ok(pre.events[i].t >= pre.events[i - 1].t);
  const first = ofType(pre, 'note').filter((e) => e.step === 0 && e.key === 0).map((e) => e.midi);
  const r = preSteps[0].roots[0];
  assert.deepEqual(first, [0, 2, 4, 5, 7, 5, 4, 2, 0].map((i) => r + i)); // five_note, mirror
  // 100 bpm: 600 ms a note
  assert.ok(ofType(pre, 'note').filter((e) => e.step === 0).every((e) => e.durMs === 600));
});

test('compile: a key change is the current chord, a beat, the next chord, a beat', () => {
  const ev = pre.events;
  const k1 = ev.findIndex((e) => e.type === 'key' && e.step === 0 && e.key === 1);
  const before = ev.slice(0, k1).reverse();
  const next = before.find((e) => e.type === 'chord');
  const current = before.find((e) => e.type === 'chord' && e.role === 'current');
  const lastNote = before.find((e) => e.type === 'note');
  assert.equal(next.role, 'next');
  assert.equal(next.root, preSteps[0].roots[1]);
  assert.deepEqual(next.notes, [next.root, next.root + 4, next.root + 7]);
  assert.equal(current.root, preSteps[0].roots[0]);
  assert.equal(current.t, lastNote.t + 600);
  assert.equal(next.t, current.t + 600);
  assert.equal(ev[k1].t, next.t + 600);
  assert.equal(current.capMs, 600 - 40);
  assert.equal(next.capMs, null);
  // five_note mirror ends on its root, a chord tone: it rings into the chord
  const fades = before.slice(0, before.indexOf(current)).filter((e) => e.type === 'fade' && e.t === current.t);
  assert.equal(fades.length, 0);
  assert.ok(before.some((e) => e.type === 'fade' && e.t === next.t));
});

test('compile: later steps open with a fade and their start chord, after a 3 s pause', () => {
  const s1 = pre.events.findIndex((e) => e.type === 'step' && e.step === 1);
  const pauses = pre.events.filter((e) => e.type === 'pause' && e.step === 0);
  assert.deepEqual(pauses.map((e) => e.left), [3, 2, 1]);
  assert.equal(pauses[1].t - pauses[0].t, 1000);
  const ev = pre.events;
  assert.equal(ev[s1 - 1].type, 'fade');
  assert.equal(ev[s1 - 1].t, pauses[0].t + 3000);
  assert.equal(ev[s1 + 1].type, 'chord');
  assert.equal(ev[s1 + 1].role, 'start');
  assert.equal(ev[s1 + 1].root, preSteps[1].roots[0]);
  assert.equal(ev[s1 + 2].type, 'key');
  assert.equal(ev[s1 + 2].t - ev[s1 + 1].t, 600); // 100 bpm
  assert.equal(ofType(pre, 'pause').length, 3 * (preSteps.length - 1));
});

test('compile: the length agrees with the estimator to a second, every routine and voice', () => {
  for (const r of ROUTINES) {
    for (const v of VOICES) {
      const steps = S.stepsFor(entryOf(r), { preset: v.id, ...presetVoice(v) }, REGISTERS);
      const tl = S.compile(steps, { skipFirstChord: true });
      const diff = Math.abs(tl.durationMs - r.presets[v.id].durationMs);
      assert.ok(diff <= 1000, `${r.id} ${v.id}: ${tl.durationMs} against ${r.presets[v.id].durationMs}`);
    }
  }
});

test('compile: the single scale player keeps its first chord', () => {
  const s = scaleById.five_note;
  const steps = S.stepsFor({ kind: 'scale', ...s }, { preset: 'tenor', ...presetVoice(tenor) });
  const tl = S.compile(steps, { skipFirstChord: false });
  const ev = tl.events.filter((e) => e.type !== 'count');
  assert.equal(ev[0].type, 'step');
  assert.deepEqual([ev[1].type, ev[1].role, ev[1].t], ['chord', 'start', 3000]);
  assert.deepEqual([ev[2].type, ev[2].t], ['key', 3000 + Math.round(60000 / 72)]);
  assert.equal(ofType(tl, 'pause').length, 0);
  assert.equal(ofType(tl, 'key').length, s.presets.tenor.roots.length);
});

const one = (over) => ({ intervals: [0, 2, 4, 5, 7], beats: null, tempo: 100, direction: 'normal', repeatCount: 1, roots: [48, 49], cueOffset: 0, ...over });

test('compile: above 160 bpm there is no current chord', () => {
  const fast = S.compile([one({ tempo: 170 })], { countIn: 0 });
  assert.deepEqual(ofType(fast, 'chord').map((e) => e.role), ['start', 'next']);
  const at160 = S.compile([one({ tempo: 160 })], { countIn: 0 });
  assert.deepEqual(ofType(at160, 'chord').map((e) => e.role), ['start', 'current', 'next']);
});

test('compile: a pattern that ends off its chord is faded before the current chord', () => {
  const tl = S.compile([one({ intervals: [0, 2] })], { countIn: 0 });
  const cur = ofType(tl, 'chord').find((e) => e.role === 'current');
  assert.ok(tl.events.some((e) => e.type === 'fade' && e.t === cur.t && tl.events.indexOf(e) < tl.events.indexOf(cur)));
  // inverted five_note ends on its root: no fade
  const inv = S.compile([one({ direction: 'inverted' })], { countIn: 0 });
  const c2 = ofType(inv, 'chord').find((e) => e.role === 'current');
  assert.ok(!inv.events.some((e) => e.type === 'fade' && e.t === c2.t));
});

test('compile: repeats are a silent beat apart on the same key, with no cue', () => {
  const tl = S.compile([one({ repeatCount: 3, roots: [60] })], { countIn: 0 });
  const gaps = tl.events.filter((e) => e.type === 'gap');
  assert.deepEqual(gaps.map((e) => [e.kind, e.ms]), [['repeat', 600], ['repeat', 600]]);
  assert.equal(ofType(tl, 'note').length, 15);
  assert.equal(ofType(tl, 'chord').length, 1);
});

test('compile: rests take their time and sound nothing', () => {
  const tl = S.compile([one({ intervals: scaleById.single_note.intervals, roots: [57] })], { countIn: 0 });
  assert.equal(ofType(tl, 'note').length, 1);
  assert.equal(ofType(tl, 'rest').length, 3);
  assert.equal(tl.durationMs, 600 + 4 * 600);
});

test('compile: minor patterns are cued minor, high roots voiced down, quiet above C6', () => {
  const minor = S.compile([one({ intervals: scaleById.natural_minor.intervals })], { countIn: 0 });
  assert.deepEqual(ofType(minor, 'chord')[0].notes, [48, 51, 55]);
  assert.deepEqual(S.cueChordNotes(98), [98, 90, 93]);
  assert.deepEqual(S.cueChordNotes(98, true), [98, 89, 93]);
  assert.deepEqual(S.cueChordNotes(96), [96, 100, 103]);
  assert.equal(S.cueVolumeFor(84), 0.4);
  assert.equal(S.cueVolumeFor(83), 0.8);
  assert.equal(ofType(minor, 'chord')[0].volume, 0.8);
});

test('compile: the breathe gap sits between the current and the next chord', () => {
  const tl = S.compile([one()], { countIn: 0, pauseAfterKeyMs: 1500 });
  const roles = tl.events.filter((e) => e.type === 'chord' || e.type === 'gap').map((e) => e.role || e.kind);
  assert.deepEqual(roles, ['start', 'current', 'breathe', 'next']);
  assert.equal(ofType(tl, 'chord').find((e) => e.role === 'current').capMs, 600 + 1500 - 40);
});

test('compile: low and high bound every sounded pitch, chords included', () => {
  const notes = pre.events.flatMap((e) => (e.type === 'note' ? [e.midi] : e.type === 'chord' ? e.notes : []));
  assert.equal(pre.low, Math.min(...notes));
  assert.equal(pre.high, Math.max(...notes));
});

test('helpers follow the Dart arithmetic', () => {
  assert.equal(S.patternSpan([0, -1000, 7, -3]), 10);
  assert.equal(S.patternDepth([0, -1000, 7, -3]), 3);
  assert.deepEqual(S.runOrder([0, 2, 4], 'mirror'), [0, 2, 4, 2, 0]);
  assert.deepEqual(S.beatsFor([0, 2, 4], [1, 2, 0.5], 'mirror'), [1, 2, 0.5, 2, 1]);
  assert.deepEqual(S.beatsFor([0, 2, 4], [1, 0, 1], 'normal'), [1, 1, 1]);
  assert.equal(S.isCueChordTone(-8), true); // Dart: -8 % 12 == 4
  assert.equal(S.isMinorPattern([0, 3, 7]), true);
  assert.equal(S.isMinorPattern([0, 3, 4, 7]), false);
  assert.equal(S.comfortableStartMidi({ rangeLow: 48, rangeHigh: 72, scaleSpan: 7 }), 54);
  assert.equal(S.comfortableStartMidi({ rangeLow: 48, rangeHigh: 72, scaleSpan: 7, primoPassaggio: 62 }), 50);
});

// --------------------------------------------------------------------- play

class Clock {
  constructor() {
    this.now = 0;
    this.timers = new Map();
    this.seq = 0;
  }
  setInterval(fn, ms) {
    const id = ++this.seq;
    this.timers.set(id, { fn, ms });
    return id;
  }
  clearInterval(id) {
    this.timers.delete(id);
  }
  // advance in tick steps, running every interval timer each step
  run(seconds, step = 0.025) {
    const end = this.now + seconds;
    while (this.now < end - 1e-9) {
      this.now = Math.min(end, this.now + step);
      for (const t of [...this.timers.values()]) t.fn();
    }
  }
}

function fakes() {
  const clock = new Clock();
  const context = {
    get currentTime() {
      return clock.now;
    },
    destination: {},
    createOscillator: () => ({ frequency: {}, connect() {}, start(t) { this.started = t; }, stop(t) { this.stopped = t ?? clock.now; } }),
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }),
  };
  const calls = [];
  const piano = {
    ringForNote,
    ringTimeMsForBpm,
    playNote(midi, opts) {
      const v = { midi, start: opts.when, stopAt: opts.when + opts.ringMs / 1000, stops: [], stop(ms) { this.stops.push(ms); } };
      calls.push({ kind: 'note', midi, ...opts, scheduledAt: clock.now, v });
      return Promise.resolve(v);
    },
    fadeAll(fadeMs, at) {
      calls.push({ kind: 'fade', fadeMs, at, scheduledAt: clock.now });
    },
  };
  return { clock, context, piano, calls };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

test('play: every sound is scheduled ahead on the audio clock, never further than the lookahead', async () => {
  const { clock, context, piano, calls } = fakes();
  const tl = S.compile(preSteps.slice(0, 1), { skipFirstChord: true });
  const seen = [];
  const h = S.play(tl, { piano, context, onEvent: (e) => seen.push({ e, at: clock.now }), timers: clock });
  clock.run(20);
  await flush();
  const notes = calls.filter((c) => c.kind === 'note');
  assert.ok(notes.length > 0);
  for (const c of notes) {
    assert.ok(c.when >= c.scheduledAt, 'scheduled before it sounds');
    assert.ok(c.when - c.scheduledAt <= 0.3 + 0.026, 'within the lookahead');
  }
  const firstNote = tl.events.find((e) => e.type === 'note');
  assert.ok(Math.abs(notes[0].when - (h.startTime + firstNote.t / 1000)) < 1e-9);
  assert.equal(notes[0].velocity, 1);
  const [ring, fade] = ringForNote(firstNote.durMs);
  assert.equal(notes[0].ringMs, ring);
  assert.equal(notes[0].fadeMs, fade);
  // events reach the page once they sound, in order
  for (const s of seen) assert.ok(s.at >= h.startTime + s.e.t / 1000 - 1e-9);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].e.t >= seen[i - 1].e.t);
  h.stop();
});

test('play: chords carry their volume and ring, the current one capped', async () => {
  const { clock, context, piano, calls } = fakes();
  const tl = S.compile([one({ roots: [48, 50] })], { countIn: 0 });
  S.play(tl, { piano, context, timers: clock });
  clock.run(10);
  await flush();
  const byStart = (t) => calls.filter((c) => c.kind === 'note' && Math.abs(c.when - t) < 1e-9);
  const chords = tl.events.filter((e) => e.type === 'chord');
  const t0 = calls[0].when - chords[0].t / 1000;
  for (const ch of chords) {
    const hit = byStart(t0 + ch.t / 1000);
    assert.deepEqual(hit.map((c) => c.midi), ch.notes);
    for (const c of hit) assert.equal(c.velocity, 0.8);
    const want = ch.role === 'current' ? Math.max(50, Math.min(ringTimeMsForBpm(100), 560)) : ringTimeMsForBpm(100);
    for (const c of hit) assert.equal(c.ringMs, want);
  }
  const fades = calls.filter((c) => c.kind === 'fade');
  assert.ok(fades.length >= 1);
  assert.ok(fades.every((f) => f.fadeMs === 60));
});

test('play: stop silences what is ahead, fades what sounds, and ends the events', async () => {
  const { clock, context, piano, calls } = fakes();
  const tl = S.compile(preSteps.slice(0, 1), { skipFirstChord: true });
  const seen = [];
  const h = S.play(tl, { piano, context, onEvent: (e) => seen.push(e), timers: clock });
  clock.run(5.3);
  await flush();
  h.stop();
  const n = seen.length;
  const ahead = calls.filter((c) => c.kind === 'note' && c.when > clock.now);
  const sounding = calls.filter((c) => c.kind === 'note' && c.when <= clock.now && c.v.stopAt > clock.now);
  assert.ok(ahead.length > 0, 'something was scheduled ahead');
  for (const c of ahead) assert.deepEqual(c.v.stops, [undefined]);
  for (const c of sounding) assert.deepEqual(c.v.stops, [60]);
  const before = calls.length;
  clock.run(5);
  await flush();
  assert.equal(seen.length, n, 'no event after stop');
  assert.equal(calls.length, before, 'nothing scheduled after stop');
  assert.equal(await h.done, 'stopped');
  assert.equal(clock.timers.size, 0);
});

test('play: done resolves at the end', async () => {
  const { clock, context, piano } = fakes();
  const tl = S.compile([one({ roots: [60] })], { countIn: 1 });
  const seen = [];
  const h = S.play(tl, { piano, context, onEvent: (e) => seen.push(e.type), timers: clock });
  clock.run(tl.countInMs / 1000 + tl.durationMs / 1000 + 1);
  assert.equal(await h.done, 'end');
  assert.equal(seen[0], 'count');
  assert.equal(seen[seen.length - 1], 'end');
  assert.equal(clock.timers.size, 0);
});

test('play: rate speeds up the clock and the rings for tests', async () => {
  const { clock, context, piano, calls } = fakes();
  const tl = S.compile([one({ roots: [60] })], { countIn: 0 });
  const h = S.play(tl, { piano, context, rate: 10, timers: clock });
  clock.run(1);
  await flush();
  const notes = calls.filter((c) => c.kind === 'note' && c.velocity === 1);
  assert.equal(notes.length, 5);
  assert.ok(Math.abs(notes[1].when - notes[0].when - 0.06) < 1e-9);
  assert.equal(notes[0].ringMs, ringForNote(600)[0] / 10);
  assert.equal(await h.done, 'end');
});

test('play: after a stalled timer the rest slides along instead of sounding at once', async () => {
  const { clock, context, piano, calls } = fakes();
  const tl = S.compile([one({ roots: [60, 62] })], { countIn: 0 });
  S.play(tl, { piano, context, timers: clock });
  clock.run(0.5);
  clock.now += 2; // a hidden tab: no timer for two seconds
  clock.run(6);
  await flush();
  const notes = calls.filter((c) => c.kind === 'note' && c.velocity === 1);
  assert.equal(notes.length, 10);
  for (const c of notes) assert.ok(c.when >= c.scheduledAt - 1e-9, 'never in the past');
  const gaps = notes.slice(1).map((c, i) => Math.round((c.when - notes[i].when) * 1000));
  // within a key the notes keep their 600 ms; only the stall itself is a longer gap
  assert.equal(gaps.filter((g) => g === 600).length, 7, JSON.stringify(gaps));
});
