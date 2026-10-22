// Unit tests for js/audio/piano.js on a fake Web Audio graph.
//
//   node --test tool/tests/piano/
//
// The fake evaluates gain automation the way the Web Audio spec does (steps
// at setValueAtTime, lines into linearRampToValueAtTime, cancel drops events
// at or after its time), so the envelopes are checked as heard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dartTable, GOLDEN } from './make_ring_golden.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(site, 'audio/piano-web/manifest.json'), 'utf8'));
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const recorded = manifest.notes.map((n) => n.midi);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

class Param {
  constructor(value) {
    this.value = value;
    this.events = [];
  }
  add(type, v, t) {
    this.events.push({ type, v, t });
    this.events.sort((a, b) => a.t - b.t); // stable: same time keeps call order
  }
  setValueAtTime(v, t) {
    this.add('set', v, t);
  }
  linearRampToValueAtTime(v, t) {
    this.add('ramp', v, t);
  }
  cancelScheduledValues(t) {
    this.events = this.events.filter((e) => e.t < t);
  }
  at(x) {
    let t0 = 0;
    let v0 = this.value;
    for (const e of this.events) {
      if (x < e.t) return e.type === 'ramp' ? v0 + ((e.v - v0) * (x - t0)) / (e.t - t0) : v0;
      t0 = e.t;
      v0 = e.v;
    }
    return v0;
  }
}

class Node {
  connect(n) {
    (this.to ||= []).push(n);
    return n;
  }
  disconnect() {
    this.to = [];
  }
}

class Source extends Node {
  constructor(ctx) {
    super();
    this.context = ctx;
    this.playbackRate = new Param(1);
    this.started = null;
    this.stopped = null;
    this.onended = null;
    ctx.sources.push(this);
  }
  start(t = 0) {
    if (this.started !== null) throw new Error('started twice');
    this.started = t;
  }
  stop(t = 0) {
    if (this.started === null) throw new Error('stop before start');
    this.stopped = t;
  }
}

class Gain extends Node {
  constructor() {
    super();
    this.gain = new Param(1);
  }
}

class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'suspended';
    this.destination = new Node();
    this.sources = [];
    this.resumes = 0;
  }
  resume() {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain() {
    return new Gain();
  }
  createWaveShaper() {
    const n = new Node();
    n.curve = null;
    return n;
  }
  createBufferSource() {
    return new Source(this);
  }
  createBuffer(channels, length, rate) {
    return { duration: length / rate, length, sampleRate: rate };
  }
  decodeAudioData(data) {
    return Promise.resolve({ duration: data.duration, file: data.file });
  }
  advance(t) {
    this.currentTime = t;
    for (const s of this.sources) {
      if (!s.ended && s.stopped !== null && s.stopped <= t) {
        s.ended = true;
        if (s.onended) s.onended();
      }
    }
  }
  voices() {
    return this.sources.filter((s) => s.buffer && s.buffer.file);
  }
}

const fetched = [];
let fetchMode = 'now';
const parked = [];
function respond(url) {
  const file = url.split('/').pop().split('?')[0];
  const note = manifest.notes.find((n) => n.file === file);
  return { ok: !!note, status: note ? 200 : 404, arrayBuffer: async () => ({ file, duration: note.duration }) };
}
globalThis.fetch = (url) => {
  fetched.push(url);
  if (fetchMode === 'now') return Promise.resolve(respond(url));
  return new Promise((resolve) => parked.push(() => resolve(respond(url))));
};
const releaseParked = async () => {
  while (parked.length) parked.shift()();
  await flush();
};
let constructed = 0;
globalThis.AudioContext = class extends FakeContext {
  constructor() {
    super();
    constructed++;
  }
};

const piano = await import('../../../js/audio/piano.js');
const fileOf = (url) => url.split('/').pop().split('?')[0];
const midiOf = (url) => Number(fileOf(url).split('_')[0]);

function fresh() {
  piano.init([], '/reset/');
  piano.init(manifest);
  const ctx = new FakeContext();
  piano.useContext(ctx);
  fetched.length = 0;
  fetchMode = 'now';
  return ctx;
}

test('nothing is fetched or created before the first call that needs audio', async () => {
  assert.equal(fetched.length, 0);
  assert.equal(constructed, 0);
  piano.init(manifest);
  piano.sampleFor(60);
  piano.ringForNote(500);
  piano.stopAll();
  piano.fadeAll();
  assert.equal(piano.busyUntil(), 0);
  assert.equal(fetched.length, 0);
  assert.equal(constructed, 0);
  const ctx = piano.getContext();
  assert.equal(constructed, 1);
  assert.equal(ctx.resumes, 1, 'a suspended context is resumed');
  assert.equal(ctx.sources[0].started, 0, 'the iOS unlock buffer plays inside the tap');
  assert.equal(piano.getContext(), ctx, 'one context, reused');
  assert.equal(fetched.length, 0);
  await piano.ensureNote(60);
  assert.deepEqual(fetched, ['/audio/piano-web/60_C4.mp3?v=' + manifest.notes.find((n) => n.midi === 60).sha256.slice(0, 8)]);
});

test('every playable note is at most one semitone from a recording', () => {
  fresh();
  assert.deepEqual(piano.playableRange(), { low: 32, high: 91 });
  for (let m = 21; m <= 108; m++) {
    const s = piano.sampleFor(m);
    if (m < 32 || m > 91) {
      assert.equal(s, null, `MIDI ${m} is outside the set`);
      assert.equal(piano.isPlayable(m), false);
      continue;
    }
    assert.ok(recorded.includes(s.sample), `MIDI ${m} uses a recording`);
    assert.ok(Math.abs(s.shift) <= 1, `MIDI ${m} shifts ${s.shift}`);
    assert.equal(m - s.shift, s.sample);
    assert.equal(s.rate, 2 ** (s.shift / 12));
    assert.equal(s.file, manifest.notes.find((n) => n.midi === s.sample).file);
  }
  assert.equal(piano.sampleFor(60.4).midi, 60);
  assert.equal(piano.sampleFor(NaN), null);
  assert.equal(piano.sampleFor(undefined), null);
});

test('ring times match the app (Dart golden)', () => {
  for (const [d, ring, fade] of golden.ringForNote) assert.deepEqual(piano.ringForNote(d), [ring, fade], `ringForNote(${d})`);
  for (const [bpm, ms] of golden.ringTimeMsForBpm) assert.equal(piano.ringTimeMsForBpm(bpm), ms, `ringTimeMsForBpm(${bpm})`);
  const c = golden.constants;
  assert.equal(piano.MAX_POLYPHONY, c.maxPolyphony);
  assert.equal(piano.BAND_MARGIN, c.bandMargin);
  assert.equal(piano.TAP_RING_MS, c.tapRingTimeMs);
  assert.equal(piano.MAX_NOTE_RING_MS, c.maxNoteRingMs);
  assert.equal(piano.RELEASE_TAIL_MIN_MS, c.releaseTailMinMs);
  assert.equal(piano.RELEASE_TAIL_MAX_MS, c.releaseTailMaxMs);
});

test('the golden is what the app\'s Dart gives today', (t) => {
  const now = dartTable();
  if (!now) return t.skip('no app checkout or no dart on PATH');
  assert.deepEqual(now.constants, golden.constants);
  assert.deepEqual(now.ringForNote, golden.ringForNote);
  assert.deepEqual(now.ringTimeMsForBpm, golden.ringTimeMsForBpm);
});

test('loads in flight are shared, and a held sample is not fetched again', async () => {
  fresh();
  const [a, b, c] = await Promise.all([piano.ensureNote(59), piano.ensureNote(60), piano.ensureNote(61)]);
  assert.equal(fetched.length, 1);
  assert.equal(fileOf(fetched[0]), '60_C4.mp3');
  assert.ok(a && a === b && b === c);
  await piano.ensureNote(60);
  await piano.playNote(61);
  assert.equal(fetched.length, 1);
  assert.equal(await piano.ensureNote(31), null);
  assert.equal(fetched.length, 1);
});

test('prepareRange holds the band and its margin, and lets go of the rest', async () => {
  fresh();
  const progress = [];
  assert.equal(await piano.prepareRange(60, 72, { onProgress: (d, n) => progress.push([d, n]) }), true);
  assert.deepEqual(fetched.map(midiOf).sort((x, y) => x - y), [54, 57, 60, 63, 66, 69, 72, 75, 78]);
  assert.deepEqual(progress[0], [0, 9]);
  assert.deepEqual(progress.at(-1), [9, 9]);
  fetched.length = 0;
  assert.equal(await piano.prepareRange(40, 45), true);
  assert.deepEqual(fetched.map(midiOf).sort((x, y) => x - y), [33, 36, 39, 42, 45, 48, 51]);
  fetched.length = 0;
  await piano.ensureNote(60);
  assert.deepEqual(fetched.map(midiOf), [60], 'C4 was let go with the old band');
  fetched.length = 0;
  assert.equal(await piano.prepareRange(10, 20), true, 'a band under the set clamps to it');
  assert.deepEqual(fetched, [], 'A1 is held already');
  await piano.ensureNote(36);
  assert.deepEqual(fetched.map(midiOf), [36], 'and C2 was let go');
});

test('a newer band takes over from an older one', async () => {
  fresh();
  fetchMode = 'park';
  const wide = piano.prepareRange(33, 90, { margin: 0 });
  await flush();
  assert.equal(fetched.length, 4, 'four loads at a time');
  const narrow = piano.prepareRange(60, 60, { margin: 0 });
  await flush();
  for (let i = 0; i < 6 && parked.length; i++) await releaseParked();
  assert.equal(await narrow, true);
  assert.equal(await wide, false);
  assert.deepEqual(fetched.map(midiOf).sort((x, y) => x - y), [33, 36, 39, 42, 60], 'the old band started nothing more');
});

test('a note rings, fades and stops the way the app\'s does', async () => {
  const ctx = fresh();
  await piano.prepareRange(60, 60, { margin: 0 });
  ctx.currentTime = 1;
  const v = await piano.playNote(60, { when: 2, ringMs: 500, velocity: 0.8 });
  const g = v.gain.gain;
  assert.equal(v.start, 2);
  assert.equal(v.src.started, 2);
  close(v.src.stopped, 2.52); // ring + 20 ms
  assert.equal(v.src.playbackRate.value, 1);
  close(g.at(2), 0.8);
  close(g.at(2.349), 0.8); // the fade is the last 30% of the ring: 150 ms
  close(g.at(2.425), 0.4);
  close(g.at(2.5), 0);
  const [ringMs, fadeMs] = piano.ringForNote(300); // 450, 150
  const w = await piano.playNote(60, { when: 3, ringMs, fadeMs });
  close(w.gain.gain.at(3.299), 1);
  close(w.gain.gain.at(3.375), 0.5);
  close(w.src.stopped, 3.47);
  const late = await piano.playNote(60, { when: 0.5, ringMs: 50 });
  assert.equal(late.start, 1, 'a late note starts now, not in the past');
  close(late.gain.gain.at(1.029), 1); // 30% of 50 ms is 15: raised to 20
  close(late.gain.gain.at(1.04), 0.5);
  const loud = await piano.playNote(60, { when: 4, velocity: 3 });
  close(loud.gain.gain.at(4), 1);
  const quiet = await piano.playNote(60, { when: 4.5, velocity: -1 });
  close(quiet.gain.gain.at(4.5), 0);
});

test('a shifted note plays at 2^(1/12) and rings no longer than its sample', async () => {
  const ctx = fresh();
  ctx.currentTime = 1;
  const v = await piano.playNote(61, { when: 1, ringMs: 8000 });
  assert.equal(v.sample, 60);
  close(v.src.playbackRate.value, 2 ** (1 / 12));
  const ring = Math.floor((5 / 2 ** (1 / 12)) * 1000); // 4719 ms
  close(v.src.stopped, 1 + ring / 1000 + 0.02);
  close(v.gain.gain.at(1 + ring / 1000), 0);
  const d = await piano.playNote(59, { when: 1 });
  close(d.src.playbackRate.value, 2 ** (-1 / 12));
});

test('a seventh voice fades the oldest over 30 ms and stops it at 40 ms', async () => {
  const ctx = fresh();
  await piano.prepareRange(60, 72, { margin: 0 });
  ctx.currentTime = 1;
  const v = [];
  for (let i = 0; i < 6; i++) v.push(await piano.playNote(60 + i, { when: 1 + i / 10 }));
  const before = v.map((x) => x.src.stopped);
  v.push(await piano.playNote(66, { when: 1.6 }));
  const g = v[0].gain.gain;
  close(g.at(1.6), 1);
  close(g.at(1.615), 0.5);
  close(g.at(1.63), 0);
  close(v[0].src.stopped, 1.64);
  for (let i = 1; i < 6; i++) assert.equal(v[i].src.stopped, before[i], `voice ${i} untouched`);
  v.push(await piano.playNote(67, { when: 1.7 }));
  close(v[1].src.stopped, 1.74);
  // A voice faded during its own fade keeps the ramp it was on up to then
  const ctx2 = fresh();
  ctx2.currentTime = 0;
  const a = await piano.playNote(60, { when: 0, ringMs: 1000 }); // fades 0.7 to 1.0
  for (let i = 0; i < 5; i++) await piano.playNote(60, { when: 0.1 });
  await piano.playNote(60, { when: 0.85 });
  close(a.gain.gain.at(0.8), 1 - 1 / 3);
  close(a.gain.gain.at(0.85), 0.5);
  close(a.gain.gain.at(0.865), 0.25);
  close(a.gain.gain.at(0.88), 0);
});

test('fadeAll lets go of voices that started before `at`, and they stop counting', async () => {
  const ctx = fresh();
  await piano.prepareRange(60, 72, { margin: 0 });
  ctx.currentTime = 1;
  const a = await piano.playNote(60, { when: 1 });
  const b = await piano.playNote(64, { when: 2 });
  const bStop = b.src.stopped;
  piano.fadeAll(250, 1.5);
  close(a.gain.gain.at(1.5), 1);
  close(a.gain.gain.at(1.625), 0.5);
  close(a.gain.gain.at(1.75), 0);
  close(a.src.stopped, 1.77);
  assert.equal(b.src.stopped, bStop);
  for (let i = 0; i < 5; i++) await piano.playNote(65 + i, { when: 2.1 + i / 10 });
  assert.equal(b.src.stopped, bStop, 'B and five more make six: nothing evicted');
  await piano.playNote(72, { when: 2.7 });
  close(b.src.stopped, 2.74);
});

test('stopAll silences now, and scheduled or loading notes never sound', async () => {
  const ctx = fresh();
  await piano.prepareRange(60, 72, { margin: 0 });
  ctx.currentTime = 1;
  const a = await piano.playNote(60, { when: 1 });
  const b = await piano.playNote(64, { when: 3 });
  fetchMode = 'park';
  const c = piano.playNote(90, { when: 1.5 });
  ctx.currentTime = 1.2;
  piano.stopAll();
  close(a.gain.gain.at(1.2), 1);
  close(a.gain.gain.at(1.21), 0);
  close(a.src.stopped, 1.21);
  assert.ok(b.src.stopped <= b.start, 'B never starts');
  close(b.gain.gain.at(3), 0);
  const sources = ctx.sources.length;
  await releaseParked();
  assert.equal(await c, null, 'a note still loading at Stop stays silent');
  assert.equal(ctx.sources.length, sources);
});

test('busyUntil and whenIdle track the last voice', async () => {
  const ctx = fresh();
  await piano.prepareRange(60, 60, { margin: 0 });
  ctx.currentTime = 1;
  assert.equal(piano.busyUntil(), 0);
  await piano.playNote(60, { when: 1, ringMs: 500 });
  close(piano.busyUntil(), 1.52);
  assert.equal(piano.isBusy(), true);
  ctx.advance(1.6);
  assert.equal(piano.busyUntil(), 0);
  await piano.whenIdle();
});

test('the audio session is set to playback for the piano and handed back on release', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const session = { type: 'auto' };
  Object.defineProperty(globalThis, 'navigator', { value: { audioSession: session }, configurable: true });
  try {
    fresh();
    await piano.prepareRange(60, 60, { margin: 0 });
    assert.equal(session.type, 'auto', 'loading leaves it alone');
    await piano.playNote(60);
    assert.equal(session.type, 'playback');
    piano.release();
    assert.equal(session.type, 'auto');
  } finally {
    Object.defineProperty(globalThis, 'navigator', saved);
  }
});

test('the master stage is the app\'s mix: centre pan, SoLoud roundoff, 0.95', () => {
  fresh();
  const shaper = piano.getOutput();
  assert.deepEqual(shaper.to, [piano.getContext().destination]);
  const curve = shaper.curve;
  assert.equal(curve.length, 8193);
  assert.equal(curve[4096], 0);
  const at = (x) => curve[Math.round(((x / 2 + 1) / 2) * 8192)]; // x is the mix after the pan gain
  close(at(0.5), 0.95 * (0.87 * 0.5 - 0.1 * 0.125), 1e-6);
  close(at(-0.5), -0.95 * (0.87 * 0.5 - 0.1 * 0.125), 1e-6);
  close(at(1.65), 0.95 * 0.9862875, 1e-4); // between two curve points
  close(at(1.7), 0.95 * 0.9862875, 1e-6);
  close(at(2), 0.95 * 0.9862875, 1e-6);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1], 'monotonic');
  assert.ok(Math.max(...curve) < 1, 'never clips');
});

test('a context closed elsewhere is replaced, and samples survive the change', async () => {
  const ctx = fresh();
  const buf = await piano.ensureNote(60);
  ctx.state = 'closed';
  const made = constructed;
  const next = piano.getContext();
  assert.notEqual(next, ctx);
  assert.equal(constructed, made + 1);
  fetched.length = 0;
  const v = await piano.playNote(60);
  assert.equal(v.src.buffer, buf);
  assert.equal(fetched.length, 0);
});

test('init with the same manifest keeps the samples; another base starts over', async () => {
  fresh();
  await piano.ensureNote(60);
  fetched.length = 0;
  piano.init(manifest);
  await piano.ensureNote(60);
  assert.equal(fetched.length, 0);
  piano.init(manifest, '/elsewhere');
  await piano.ensureNote(60);
  assert.equal(fetched.length, 1);
  assert.ok(fetched[0].startsWith('/elsewhere/60_C4.mp3'));
  piano.init({ notes: [{ midi: 60, file: '60_C4.mp3' }] });
  await piano.ensureNote(61);
  assert.equal(fetched.at(-1), '/audio/piano-web/60_C4.mp3', 'a slim manifest has no ?v=');
  assert.equal(piano.sampleFor(62), null);
});
