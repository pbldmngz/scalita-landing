// pitch.js against the app's rules, on synthetic reading streams and tones.
//   node --test tool/tests/parity/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  ABSOLUTE_LOW_HZ, DEFAULT_LOW_HZ, HIGH_HZ, NoteLock, PitchReader, Stability,
  acceptWindow, centsBetween, hzToMidi, meterLevel, midiToHz, nearestMidi,
} from '../../../js/audio/pitch.js';
import { noteRuns } from './runs.mjs';
import { fixtures, readWav, takesDir } from './takes.mjs';

const RATE = 44100;
const SIZE = 2048;
const STEP = SIZE / RATE; // one reading per 2048 samples, as the listener reads

// Deterministic jitter, so a failure reproduces
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Stability over a stream of frequencies; returns [{t, s}]
function stream(freqs) {
  const st = new Stability();
  return freqs.map((hz, i) => ({ t: (i + 1) * STEP, s: st.push(hz) }));
}

// A voice-like tone: a fundamental and four harmonics, phase continuous
function tone(hz, seconds, { amp = 0.2, rate = RATE } = {}) {
  const n = Math.round(seconds * rate);
  const x = new Float64Array(n);
  const w = [1, 0.5, 0.33, 0.25, 0.2];
  const norm = w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 0; h < w.length; h++) v += w[h] * Math.sin((2 * Math.PI * hz * (h + 1) * i) / rate);
    x[i] = (amp * v) / norm;
  }
  return x;
}

function readAll(reader, x) {
  const out = [];
  for (let o = 0; o + SIZE <= x.length; o += SIZE) out.push(reader.read(x, o, (o + SIZE) / RATE));
  return out;
}

test('note helpers agree with A4 = 440', () => {
  assert.equal(midiToHz(69), 440);
  assert.equal(hzToMidi(440), 69);
  assert.equal(nearestMidi(261.6256), 60);
  assert.ok(Math.abs(centsBetween(880, 440) - 1200) < 1e-9);
  assert.ok(Math.abs((hzToMidi(446) - 69) * 100 - 23.44) < 0.01);
});

test('accept window: 65 to 4200 Hz, or an octave around a target', () => {
  assert.deepEqual(acceptWindow(), { low: DEFAULT_LOW_HZ, high: HIGH_HZ });
  assert.equal(acceptWindow({ lowFloorHz: 55 }).low, 55);
  assert.equal(acceptWindow({ lowFloorHz: 20 }).low, ABSOLUTE_LOW_HZ);
  assert.equal(acceptWindow({ lowFloorHz: 90 }).low, DEFAULT_LOW_HZ);
  const c4 = acceptWindow({ targetMidi: 60 });
  assert.ok(Math.abs(c4.low - midiToHz(48)) < 1e-9 && Math.abs(c4.high - midiToHz(72)) < 1e-9);
  assert.equal(acceptWindow({ targetMidi: 30 }).low, ABSOLUTE_LOW_HZ);
  assert.equal(acceptWindow({ targetMidi: 110 }).high, HIGH_HZ);
});

test('stability needs ten readings, then reads the spread around the median', () => {
  const st = new Stability();
  for (let i = 0; i < 9; i++) assert.equal(st.push(220), 0);
  assert.equal(st.push(220), 1);
  // 30 readings kept: 29 at 220 and one a semitone up is 100/30 cents off
  const s = new Stability();
  for (let i = 0; i < 29; i++) s.push(220);
  assert.ok(Math.abs(s.push(midiToHz(57 + 1)) - (1 - 100 / 30 / 100)) < 1e-9);
  for (let i = 0; i < 30; i++) s.push(220);
  assert.equal(s.recent.length, 30);
  assert.equal(s.value(), 1);
});

test('a steady note is stable within 1.5 s and stays stable', () => {
  const rnd = prng(7);
  const freqs = Array.from({ length: 100 }, () => 220 * Math.pow(2, ((rnd() - 0.5) * 16) / 1200));
  const s = stream(freqs);
  const first = s.find((r) => r.s >= 0.8);
  assert.ok(first && first.t <= 1.5, 'stable by ' + (first && first.t));
  assert.ok(s.filter((r) => r.t >= first.t).every((r) => r.s >= 0.8));
});

test('a glide is never stable', () => {
  for (const centsPerSecond of [300, 600, 1200]) {
    const freqs = Array.from({ length: 80 }, (_, i) => 200 * Math.pow(2, (centsPerSecond * i * STEP) / 1200));
    assert.ok(stream(freqs).every((r) => r.s < 0.8), centsPerSecond + ' cents/s');
  }
});

test('as in the app, a glide slower than about 190 cents a second reads stable at first', () => {
  const freqs = Array.from({ length: 40 }, (_, i) => 200 * Math.pow(2, (100 * i * STEP) / 1200));
  const s = stream(freqs);
  assert.ok(s[9].s >= 0.8);
  assert.ok(s[39].s < 0.8);
});

test('an octave slip breaks stability for as long as it is in the window', () => {
  for (const slip of [110, 440]) {
    const freqs = [...Array(40).fill(220), slip, ...Array(40).fill(220)];
    const s = stream(freqs);
    assert.ok(s[39].s >= 0.8);
    for (let i = 40; i < 40 + 30; i++) assert.ok(s[i].s < 0.8, `reading ${i} after a slip to ${slip}`);
    assert.ok(s[70].s >= 0.8);
  }
});

test('PitchReader on a steady tone: believed, named, stable', () => {
  const r = readAll(new PitchReader({ sampleRate: RATE }), tone(196, 2));
  const last = r[r.length - 1];
  assert.equal(last.midi, 55);
  assert.ok(Math.abs(last.cents - (hzToMidi(196) - 55) * 100) < 0.5);
  assert.ok(last.stable && !last.gated && !last.outside && !last.fry && !last.whistle);
  const first = r.find((x) => x.stable);
  assert.ok(first.t <= 1.5);
  assert.ok(r.slice(0, 9).every((x) => !x.stable), 'ten readings before any lock');
});

test('the gate: quiet frames are silence and restart the history', () => {
  const reader = new PitchReader({ sampleRate: RATE });
  readAll(reader, tone(220, 1));
  const quiet = reader.read(tone(220, 0.1, { amp: 0.01 }), 0, 1);
  assert.ok(quiet.gated && quiet.hz === null && quiet.stability === 0 && quiet.rms < 0.04);
  const again = readAll(reader, tone(220, 0.3));
  assert.ok(again.every((x) => !x.stable), 'history restarted');
});

test('fry: outside the window, flagged, and the history survives it', () => {
  const reader = new PitchReader({ sampleRate: RATE });
  const before = readAll(reader, tone(220, 1));
  assert.ok(before[before.length - 1].stable);
  const fry = reader.read(tone(55, 0.1), 0, 1.05);
  assert.ok(fry.outside && fry.fry && fry.hz === null && Math.abs(fry.rawHz - 55) < 0.5);
  const after = reader.read(tone(220, 0.1), 0, 1.1);
  assert.ok(after.stable, 'an outside reading neither counts nor breaks');
});

test('whistle: believed but flagged at F6 and above', () => {
  const r = readAll(new PitchReader({ sampleRate: RATE }), tone(1500, 0.5, { amp: 0.3 }));
  const last = r[r.length - 1];
  assert.ok(last.hz && last.whistle && last.midi === 90);
  const below = readAll(new PitchReader({ sampleRate: RATE }), tone(1300, 0.5, { amp: 0.3 }));
  assert.ok(!below[below.length - 1].whistle);
});

test('a target narrows the window to an octave either side', () => {
  const reader = new PitchReader({ sampleRate: RATE, targetMidi: 60 });
  const far = reader.read(tone(98, 0.1), 0, 0.05);
  assert.ok(far.outside && far.hz === null);
  const near = reader.read(tone(196, 0.1), 0, 0.1);
  assert.ok(!near.outside && near.midi === 55);
  reader.setTarget(null);
  assert.ok(!reader.read(tone(98, 0.1), 0, 0.15).outside);
});

test('works at 48 kHz too', () => {
  const r48 = new PitchReader({ sampleRate: 48000 });
  const x = tone(330, 1, { rate: 48000 });
  let last = null;
  for (let o = 0; o + SIZE <= x.length; o += SIZE) last = r48.read(x, o, (o + SIZE) / 48000);
  assert.equal(last.midi, nearestMidi(330));
  assert.ok(Math.abs(last.hz - 330) < 0.05);
});

function reading(t, extra) {
  return { t, hz: 220, midi: 57, stable: true, outside: false, ...extra };
}

test('NoteLock: 600 ms of stable readings, the first stable note', () => {
  const lock = new NoteLock();
  assert.equal(lock.push(reading(1.0, { midi: 57 })), null);
  assert.equal(lock.push(reading(1.3, { midi: 58 })), null);
  assert.equal(lock.push(reading(1.59, { midi: 58 })), null);
  assert.equal(lock.push(reading(1.6, { midi: 58 })), 57);
});

test('NoteLock: an unstable reading cancels, an outside one does not', () => {
  const lock = new NoteLock();
  lock.push(reading(1.0));
  lock.push(reading(1.2, { outside: true, stable: false, hz: null, midi: null }));
  assert.equal(lock.push(reading(1.6)), 57);
  const l2 = new NoteLock();
  l2.push(reading(1.0));
  l2.push(reading(1.2, { stable: false }));
  assert.equal(l2.push(reading(1.6)), null);
  assert.equal(l2.push(reading(2.2)), 57);
});

test('NoteLock: after a lock, the next waits for a break unless reset', () => {
  const lock = new NoteLock();
  lock.push(reading(0));
  assert.equal(lock.push(reading(0.6)), 57);
  for (let t = 0.65; t < 2; t += 0.05) assert.equal(lock.push(reading(t)), null);
  lock.push(reading(2, { stable: false }));
  lock.push(reading(2.1, { midi: 60 }));
  assert.equal(lock.push(reading(2.7, { midi: 60 })), 60);
  lock.reset();
  lock.push(reading(2.8, { midi: 62 }));
  assert.equal(lock.push(reading(3.4, { midi: 62 })), 62);
});

test('meter: -60 to 0 dBFS onto 0 to 1', () => {
  assert.equal(meterLevel(0), 0);
  assert.equal(meterLevel(1), 1);
  assert.ok(Math.abs(meterLevel(0.001) - 0) < 1e-9);
  assert.ok(Math.abs(meterLevel(0.04) - (20 * Math.log10(0.04) + 60) / 60) < 1e-9);
});

const dir = takesDir();
test('the fake-mic take still gives the fixture its notes', { skip: !dir && 'no takes folder' }, () => {
  const fx = fixtures.fakeMic;
  const { rate, samples } = readWav(join(dir, fx.take));
  const reader = new PitchReader({ sampleRate: rate });
  const lock = new NoteLock();
  const readings = [], locked = [];
  for (let o = 0; o + SIZE <= samples.length; o += SIZE) {
    const r = reader.read(samples, o, (o + SIZE) / rate);
    readings.push(r);
    const m = lock.push(r);
    if (m !== null) locked.push(m);
  }
  const runs = noteRuns(readings, { minMs: fx.noteRunMinMs, windowSec: SIZE / rate });
  assert.deepEqual(locked, fx.lockedNotes);
  assert.deepEqual(runs, fx.noteRuns);
  assert.deepEqual(runs.map((m) => m - runs[0]), fx.intervals, 'what was sung');
});
