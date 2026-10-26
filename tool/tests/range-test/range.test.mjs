// The range test's logic and weight, in Node: the voice-type match against
// the app's own vectors, the two phases over the app's lock, the strings
// file against the code, the budget before interaction. With the takes
// present, the composed fake-mic input is also run through the real pitch
// reader at every window phase, at 44.1 and 48 kHz, so the browser test
// cannot depend on luck.
//
//   node --test tool/tests/range-test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { RangeSession, fill, namesAType, scaleRun, typesIn, typicalFor } from '../../../js/tools/vocal-range-run.js';
import { NoteLock, PitchReader } from '../../../js/audio/pitch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const FX = JSON.parse(readFileSync(join(HERE, 'fixtures.json'), 'utf8'));
const ENTRY = read('js/tools/vocal-range-test.js');
const RUN = read('js/tools/vocal-range-run.js');
const SRC = ENTRY + RUN;

test('typicalFor is VoiceType.closestForRange on every exported vector', () => {
  const types = json('tool/data/app/voice_types.json');
  const vectors = json('tool/data/app/voice_type_vectors.json').closestForRange;
  assert.ok(vectors.length > 100);
  for (const v of vectors) {
    assert.deepEqual(typicalFor(types, v.low, v.high).map((t) => t.id), v.types, `${v.low} to ${v.high}`);
  }
});

test('a voice type is named for a span of 12 to 35 semitones only, as VoiceType.rangeNamesAType', () => {
  const dart = join(REPO, '..', 'scalita_app', 'lib', 'core', 'models', 'voice_type.dart');
  if (existsSync(dart)) assert.match(readFileSync(dart, 'utf8'), /span >= 12 && span < 36/, 'the app rule this mirrors');
  for (const [low, high, named] of [[48, 59, false], [48, 60, true], [40, 75, true], [40, 76, false], [36, 72, false], [36, 84, false]]) {
    assert.equal(namesAType(low, high), named, `${low} to ${high}`);
  }
});

test('the voice types a range of three octaves holds whole, by their low note, as RangeShareCard counts them', () => {
  const types = json('tool/data/app/voice_types.json');
  const ids = (low, high) => typesIn(types, low, high).map((t) => t.id);
  // the app's own ranges, bass E2 to E4 (voice_type.dart) up to soprano C4 to C6
  assert.deepEqual(types.map((t) => [t.id, t.rangeLow, t.rangeHigh]).sort((a, b) => a[1] - b[1]),
    [['bass', 40, 64], ['baritone', 45, 69], ['tenor', 48, 72], ['contralto', 53, 77], ['mezzoSoprano', 57, 81], ['soprano', 60, 84]]);
  assert.deepEqual(ids(36, 84), ['bass', 'baritone', 'tenor', 'contralto', 'mezzoSoprano', 'soprano'], 'C2 to C6: all six');
  assert.deepEqual(ids(36, 72), ['bass', 'baritone', 'tenor'], 'C2 to C5: bass to tenor');
  assert.deepEqual(ids(40, 79), ['bass', 'baritone', 'tenor', 'contralto']);
  assert.deepEqual(ids(41, 77), ['baritone', 'tenor', 'contralto'], 'F2 holds no bass whole');
  assert.deepEqual(ids(52, 88), ['contralto', 'mezzoSoprano', 'soprano']);
  assert.deepEqual(ids(61, 97), [], 'above every type: more than one voice type, none whole');
  // with the microphone's C2 to E6, every span of three octaves holds one at least
  for (let low = 36; low + 36 <= 88; low++) assert.ok(ids(low, low + 36).length, low + ' to ' + (low + 36));
});

test('scaleRun climbs a major scale and lands on the top note', () => {
  assert.deepEqual(scaleRun(43, 67), [43, 45, 47, 48, 50, 52, 54, 55, 57, 59, 60, 62, 64, 66, 67]);
  assert.deepEqual(scaleRun(60, 72), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(scaleRun(60, 61), [60, 61]);
});

test('fill swaps known placeholders and keeps the rest', () => {
  assert.equal(fill('{low} to {high}', { low: 'G2', high: 'G4' }), 'G2 to G4');
  assert.equal(fill('{a} {b}', { a: 1 }), '1 {b}');
  assert.equal(fill(undefined), '');
});

// Readings as pitch.js makes them, at 2048 samples a reading
const DT = 2048 / 44100;
function steady(midi, { stable = true, n = 1 } = {}) {
  return Array.from({ length: n }, () => ({
    rms: 0.2, peak: 0.4, hz: 440 * 2 ** ((midi - 69) / 12), midi, cents: 0, stability: stable ? 0.9 : 0.3, stable,
    gated: false, outside: false, rawHz: 440 * 2 ** ((midi - 69) / 12), fry: false, whistle: midi >= 89,
  }));
}
const silence = (n) => Array.from({ length: n }, () => ({
  rms: 0, peak: 0, hz: null, midi: null, cents: null, stability: 0, stable: false,
  gated: true, outside: false, rawHz: null, fry: false, whistle: false,
}));
const fry = (n) => Array.from({ length: n }, () => ({
  rms: 0.2, peak: 0.4, hz: null, midi: null, cents: null, stability: 0, stable: false,
  gated: false, outside: true, rawHz: 55, fry: true, whistle: false,
}));
function feed(s, readings, clock) {
  const seen = [];
  for (const r of readings) {
    clock.t += DT;
    if (s.push({ ...r, t: clock.t })) seen.push(s.phase);
  }
  return seen;
}

test('the session locks the lowest, waits 1.5 s and 2 s, then locks a higher note', () => {
  const s = new RangeSession(new NoteLock());
  const clock = { t: 0 };
  assert.deepEqual(feed(s, steady(48, { n: 20 }), clock), ['shown']);
  assert.equal(s.low, 48);
  const locked = s.at;
  while (clock.t + DT - locked < 1.5) feed(s, steady(48), clock);
  assert.equal(s.phase, 'shown');
  feed(s, silence(1), clock);
  assert.equal(s.phase, 'breath');
  const breath = s.at;
  while (clock.t + DT - breath < 2) feed(s, steady(60), clock);
  assert.equal(s.phase, 'breath', 'nothing locks while breathing');
  feed(s, silence(1), clock);
  assert.equal(s.phase, 'high');
  // At or under the lowest note nothing locks, and after about 0.7 s it says so
  feed(s, steady(48, { n: 40 }), clock);
  assert.equal(s.phase, 'high');
  assert.equal(s.hint, 'aboveLowHint');
  feed(s, steady(72, { n: 20 }), clock);
  assert.equal(s.phase, 'done');
  assert.equal(s.high, 72);
  assert.equal(s.push({ ...steady(80)[0], t: clock.t + 1 }), false, 'done is final');
});

test('whistle readings neither count nor break a note, and are tallied', () => {
  const s = new RangeSession(new NoteLock());
  const clock = { t: 0 };
  feed(s, steady(55, { n: 20 }), clock);
  feed(s, silence(Math.ceil(3.6 / DT)), clock);
  assert.equal(s.phase, 'high');
  feed(s, steady(91, { n: 30 }), clock);
  assert.equal(s.phase, 'high');
  assert.equal(s.whistle, 30);
  assert.equal(s.hint, 'whistleHint');
  // A note held across whistle readings still locks on time
  const r = steady(79, { n: 8 }).concat(steady(91, { n: 3 }), steady(79, { n: 4 }));
  feed(s, r, clock);
  assert.equal(s.phase, 'done');
  assert.equal(s.high, 79);
});

test('fry is tallied and hinted in the low phase, never locked', () => {
  const s = new RangeSession(new NoteLock());
  const clock = { t: 0 };
  feed(s, fry(30), clock);
  assert.equal(s.phase, 'low');
  assert.equal(s.fry, 30);
  assert.equal(s.hint, 'fryHint');
  feed(s, steady(50, { n: 20 }), clock);
  assert.equal(s.low, 50);
});

test('a voice that wanders for 4 s is asked to hold one note', () => {
  const s = new RangeSession(new NoteLock());
  const clock = { t: 0 };
  feed(s, steady(50, { stable: false, n: Math.ceil(3.9 / DT) }), clock);
  assert.equal(s.hint, null);
  feed(s, steady(50, { stable: false, n: 4 }), clock);
  assert.equal(s.hint, 'holdSteady');
});

test('every string the code names is in ui/en/vocal-range-test.json, and nothing else is', () => {
  const ui = json('tool/content/ui/en/vocal-range-test.json');
  const literals = new Set([...SRC.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));
  // T('key') and T(cond ? 'a' : 'b'), leaving out what a condition compares
  for (const m of SRC.matchAll(/\bT\(([^,)]*)/g)) {
    for (const q of m[1].matchAll(/(?<!=== )'([A-Za-z]+)'/g)) assert.ok(q[1] in ui, 'missing ' + q[1]);
  }
  for (const k of Object.keys(ui)) assert.ok(literals.has(k), 'unused ' + k);
  const common = json('tool/content/ui/en/common.json');
  for (const m of SRC.matchAll(/\bC\.([A-Za-z]+)/g)) assert.ok(m[1] in common, 'common.' + m[1]);
  const mic = json('tool/content/ui/en/mic.json');
  for (const code of ['micUnsupported', 'micInApp', 'micBlocked', 'micDismissed', 'micNotFound', 'micBusy',
    'micInterrupted', 'micHidden', 'micFailed', 'micBluetooth', 'micSilent', 'levelQuiet', 'levelLoud']) {
    assert.ok(mic[code], 'mic.' + code);
  }
  const filled = (k, v) => (typeof v === 'string' ? assert.ok(v.trim(), k + ' is empty')
    : Object.entries(v).forEach(([k2, v2]) => filled(k + '.' + k2, v2)));
  for (const [k, v] of Object.entries(ui)) filled(k, v);
});

test('before a tap the page needs this module and mic.js only, under 15 KB gzipped', () => {
  const statics = [...ENTRY.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(statics, ['../audio/mic.js']);
  assert.ok(ENTRY.includes("import('./vocal-range-run.js')"), 'the run module loads on the first tap');
  for (const lazy of ['../audio/listener.js', '../audio/pitch.js', '../audio/piano.js', './share-card.js']) {
    assert.ok(RUN.includes(`import('${lazy}')`), lazy + ' loads on demand');
  }
  const gz = (p) => gzipSync(readFileSync(join(REPO, p)), { level: 9 }).length;
  const total = gz('js/tools/vocal-range-test.js') + gz('js/audio/mic.js');
  assert.ok(total < 15 * 1024, total + ' bytes');
});

test('no em or en dashes in what this package wrote', () => {
  const dash = new RegExp('[\\u2014\\u2013]|&' + 'mdash;|&' + 'ndash;');
  for (const p of ['js/tools/vocal-range-test.js', 'js/tools/vocal-range-run.js', 'js/tools/share-card.js', 'tool/content/ui/en/vocal-range-test.json',
    'tool/tests/range-test/fixtures.json', 'tool/tests/range-test/range.test.mjs', 'tool/tests/range-test/e2e.py',
    'tool/tests/range-test/fixture.html', 'tool/tests/range-test/README.md']) {
    if (existsSync(join(REPO, p))) assert.ok(!dash.test(read(p)), p);
  }
});

// The composed fake-mic input, through the real pitch reader
function takesDir() {
  const d = process.env.SCALITA_TAKES || resolve(HERE, FX.takesDir);
  return existsSync(d) ? d : null;
}

function readWav(path) {
  const b = readFileSync(path);
  let pos = 12, rate = 0, channels = 0, bits = 0;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4), size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      channels = b.readUInt16LE(pos + 10);
      rate = b.readUInt32LE(pos + 12);
      bits = b.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      if (channels !== 1 || bits !== 16) throw new Error(path + ': want 16-bit mono');
      const x = new Float32Array(size >> 1);
      for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(pos + 8 + i * 2) / 32768;
      return { rate, x };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error(path + ': no data');
}

function compose(segments, rate, dir) {
  const parts = [];
  for (const s of segments) {
    if (s.silence) parts.push(new Float32Array(Math.round(s.silence * rate)));
    else if (s.hz) {
      const n = Math.round(s.sec * rate), y = new Float32Array(n), ramp = Math.round(0.01 * rate);
      for (let i = 0; i < n; i++) y[i] = 0.3 * Math.sin((2 * Math.PI * s.hz * i) / rate) * Math.min(1, i / ramp, (n - 1 - i) / ramp);
      parts.push(y);
    } else {
      const w = readWav(join(dir, s.take));
      if (w.rate !== rate) throw new Error('takes are ' + w.rate + ' Hz');
      const a = Math.round((s.from || 0) * rate), b = s.to == null ? w.x.length : Math.round(s.to * rate);
      parts.push(w.x.subarray(a, b));
    }
  }
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Windowed sinc, as a browser resamples a fake capture file
function resample(x, from, to) {
  if (from === to) return x;
  const n = Math.floor((x.length * to) / from), y = new Float32Array(n), ratio = from / to, cut = Math.min(1, to / from), A = 16;
  for (let i = 0; i < n; i++) {
    const c = i * ratio, k0 = Math.floor(c);
    let s = 0;
    for (let k = k0 - A + 1; k <= k0 + A; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = c - k, arg = Math.PI * d * cut;
      s += x[k] * (arg === 0 ? cut : (Math.sin(arg) / arg) * cut) * (0.5 + 0.5 * Math.cos((Math.PI * d) / A));
    }
    y[i] = s;
  }
  return y;
}

function session(x, rate, offset) {
  const reader = new PitchReader({ sampleRate: rate, size: 2048 });
  const s = new RangeSession(new NoteLock());
  for (let i = offset; i + 2048 <= x.length && s.phase !== 'done'; i += 2048) s.push(reader.read(x, i, (i + 2048) / rate));
  return s;
}

for (const name of ['twoTakes', 'tones']) {
  const fx = FX[name];
  const needsTakes = fx.segments.some((s) => s.take);
  test(`${name}: every window phase at 44.1 and 48 kHz locks ${fx.low} then ${fx.high}`, { skip: needsTakes && !takesDir() && 'no takes folder' }, () => {
    const base = compose(fx.segments, 44100, takesDir());
    for (const rate of [44100, 48000]) {
      const x = resample(base, 44100, rate);
      for (let off = 0; off < 2048; off += 128) {
        const s = session(x, rate, off);
        const at = `${rate} Hz, phase ${off}`;
        assert.equal(s.low, fx.low, at);
        assert.equal(s.high, fx.high, at);
        assert.equal(s.fry >= 5, fx.fry, at + ' fry ' + s.fry);
        assert.equal(s.whistle >= 5, fx.whistle, at + ' whistle ' + s.whistle);
      }
    }
  });
}
