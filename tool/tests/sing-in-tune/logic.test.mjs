// js/tools/sing-in-tune.js without a browser: the bands, the notes it picks,
// how one sung note is read and a round summed up (against the app's
// scale_scorer.dart and score_analysis.dart rules), the listening check's
// pairs, its strings, its weight before the first tap.
//   node --test tool/tests/sing-in-tune/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  ROUND, MIN_JUDGED, IN_TUNE, CLOSE, EAR_STEPS, anyBand, earPairs, measureNote, median, middleBand, midiToHz,
  offset, pickTargets, random, summarize,
} from '../../../js/tools/sing-in-tune.js';
import { KEYS, fmt } from '../../../js/tools/sing-in-tune-test.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');
const json = (p) => JSON.parse(read(p));
// The mount point (idle panel, the tap) and what the tap loads (the runs)
const ENTRY = read('js/tools/sing-in-tune-test.js');
const RUNS = read('js/tools/sing-in-tune.js');
const SRC = ENTRY + RUNS;
const UI = json('tool/content/ui/en/sing-in-tune-test.json');
const COMMON = json('tool/content/ui/en/common.json');
const MIC = json('tool/content/ui/en/mic.json');

// A note sung at `cents` from midi, steady, one believed reading every
// 2048 samples at 48 kHz as listener.js makes them
function sung(midi, seconds, centsAt, { start = 10 } = {}) {
  const dt = 2048 / 48000;
  const out = [];
  for (let t = 0; t <= seconds; t += dt) out.push({ t: start + t, hz: midiToHz(midi) * 2 ** (centsAt(t) / 1200) });
  return out;
}

test('offset folds octaves and keeps the sign', () => {
  assert.deepEqual(offset(440, 69), { cents: 0, octave: 0 });
  assert.deepEqual(offset(440, 57), { cents: 0, octave: 1 });
  assert.deepEqual(offset(220, 69), { cents: 0, octave: -1 });
  const sharp = offset(440 * 2 ** (20 / 1200), 69);
  assert.ok(Math.abs(sharp.cents - 20) < 1e-9 && sharp.octave === 0);
  const flat = offset(110 * 2 ** (-35 / 1200), 69);
  assert.ok(Math.abs(flat.cents + 35) < 1e-9 && flat.octave === -2);
});

test("bands are the app's middle zone of each preset, and any voice is their middle", () => {
  const list = json('tool/data/app/voice_types.json');
  const presets = list.map((v) => [v.presetLow, v.presetHigh]);
  assert.equal(presets.length, 6);
  // echo_plan.dart echoZones: low + w ~/ 4 to high - w ~/ 4, every preset 24 wide
  const expected = { 60: [66, 78], 57: [63, 75], 53: [59, 71], 48: [54, 66], 45: [51, 63], 40: [46, 58] };
  for (const [lo, hi] of presets) assert.deepEqual(middleBand(lo, hi), expected[lo], `preset ${lo}..${hi}`);
  assert.deepEqual(anyBand(list), [57, 69]); // A3 to A4
  assert.deepEqual(middleBand(50, 54), [50, 54]); // a narrow range still gives five notes
  assert.deepEqual(middleBand(60, 62), [59, 63]);
  assert.deepEqual(anyBand([]), [57, 69]);
});

test('a round picks five notes inside the band, seeded, none twice in a row', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const notes = pickTargets([54, 66], ROUND, random(seed));
    assert.equal(notes.length, ROUND);
    assert.equal(new Set(notes).size, ROUND, `seed ${seed}: ${notes}`);
    for (const m of notes) assert.ok(m >= 54 && m <= 66);
  }
  assert.deepEqual(pickTargets([54, 66], ROUND, random(7)), pickTargets([54, 66], ROUND, random(7)));
  const tight = pickTargets([60, 62], ROUND, random(3));
  for (let i = 1; i < tight.length; i++) assert.notEqual(tight[i], tight[i - 1]);
});

test('one note: the median of its middle, the scoop trimmed, wobble once arrived', () => {
  const steady = measureNote(sung(64, 1.6, () => 12), 64);
  assert.ok(Math.abs(steady.cents - 12) < 1e-6);
  assert.equal(steady.octave, 0);
  assert.ok(steady.wobble < 1e-6);
  // A scoop from 80 cents under for the first 120 ms, then on the note
  const scoop = measureNote(sung(64, 1.6, (t) => (t < 0.12 ? -80 : 0)), 64);
  assert.ok(Math.abs(scoop.cents) < 1e-6, String(scoop.cents));
  // Sung an octave down: the note, an octave down
  const low = measureNote(sung(52, 1.6, () => -6), 64);
  assert.ok(Math.abs(low.cents + 6) < 1e-6 && low.octave === -1);
  // A vibrato 30 cents either side, 5.5 Hz: centred, and it reads as wobble
  const vib = measureNote(sung(64, 1.6, (t) => 30 * Math.sin(2 * Math.PI * 5.5 * t)), 64);
  assert.ok(Math.abs(vib.cents) < 4, String(vib.cents));
  assert.ok(vib.wobble > 15 && vib.wobble < 25, String(vib.wobble));
  // Never within 50 cents: measured, but no wobble to speak of
  assert.equal(measureNote(sung(64, 1.6, () => 70), 64).wobble, null);
  // Too short to say anything
  assert.equal(measureNote(sung(64, 0.2, () => 0), 64), null);
  assert.equal(measureNote([], 64), null);
});

test("a round in the app's figures: off, lean from 10 cents, wobble, the two bands", () => {
  const n = (cents, wobble = 4) => ({ cents, octave: 0, wobble });
  const s = summarize([n(12), n(-3), n(30), null, n(8)]);
  assert.equal(s.enough, true);
  assert.equal(s.judged, 4);
  assert.equal(s.total, 5);
  assert.equal(s.off, 10); // median of 3, 8, 12, 30
  assert.equal(s.lean, 10); // median of -3, 8, 12, 30
  assert.equal(s.inTune, 2);
  assert.equal(s.close, 3);
  assert.equal(s.wobble, 4);
  assert.equal(summarize([n(4), n(-6), n(2), n(-1), n(5)]).lean, null);
  assert.equal(summarize([n(-20), n(-14), n(-30)]).lean, -20);
  assert.equal(summarize([n(0, null), n(1, null), n(2, null)]).wobble, null);
  const few = summarize([n(3), null, null, n(4), null]);
  assert.equal(few.enough, false);
  assert.equal(few.judged, 2);
  assert.equal(few.off, undefined);
  assert.ok(MIN_JUDGED === 3 && IN_TUNE === 10 && CLOSE === 25);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  // Dart rounds halves away from zero
  assert.equal(summarize([n(-2.5), n(-2.5), n(-2.5)]).off, 3);
});

test('the listening check: steps of 4, 2 and 1, inside the band, the right way round', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const pairs = earPairs([57, 69], random(seed));
    assert.deepEqual(pairs.map((p) => p.step), EAR_STEPS);
    for (const p of pairs) {
      assert.equal(p.b - p.a, p.up ? p.step : -p.step);
      for (const m of [p.a, p.b]) assert.ok(m >= 57 && m <= 69);
    }
  }
});

test('placeholders fill, and an unknown one is left for a reader to notice', () => {
  assert.equal(fmt('Note {n} of {total}', { n: 2, total: 5 }), 'Note 2 of 5');
  assert.equal(fmt('{n}c', { n: '+12' }), '+12c');
  assert.equal(fmt('{x}', {}), '{x}');
  assert.equal(fmt(undefined, {}), '');
});

function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, prefix + k + '.') : [prefix + k]));
}

test('every string the script asks for exists, and every string in the file is used', () => {
  const asked = [...SRC.matchAll(/\bt\('([a-zA-Z0-9.]+)'\)/g)].map((m) => m[1]);
  const dynamic = [...SRC.matchAll(/\bt\('([a-zA-Z0-9.]+\.)' \+/g)].map((m) => m[1]);
  const get = (p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), UI);
  for (const p of asked) assert.ok(get(p) != null, `${p} is not in ui/en/sing-in-tune-test.json`);
  for (const pre of dynamic) assert.ok(get(pre.slice(0, -1)), `${pre} is not in the file`);
  for (const p of leaves(UI)) {
    const used = asked.some((a) => p === a || p.startsWith(a + '.')) || dynamic.some((d) => p.startsWith(d))
      || [...SRC.matchAll(/t\(([^)]*)\)/g)].some((m) => m[1].includes("'" + p + "'"));
    assert.ok(used, `${p} is never shown`);
  }
  for (const k of [...SRC.matchAll(/\bc\('([a-zA-Z]+)'\)/g)].map((m) => m[1])) assert.ok(COMMON[k], `common.${k}`);
  for (const k of ['micInApp', 'micUnsupported', 'micFailed', 'micHidden', 'micInterrupted', 'micBlocked',
    'micDismissed', 'micNotFound', 'micBusy', 'micSilent', 'micBluetooth', 'levelLoud', 'levelQuiet']) assert.ok(MIC[k], `mic.${k}`);
  for (const p of leaves(UI)) {
    const s = get(p);
    const want = /\{(\w+)\}/g;
    assert.equal(typeof s, 'string', p);
    assert.ok([...s.matchAll(want)].every((m) => SRC.includes(m[1] + ':') || SRC.includes('{ ' + m[1]) || SRC.includes(', ' + m[1])), `${p}: a placeholder the script never fills`);
  }
});

test('no verdict on the voice, no dashes a reader takes for em dashes', () => {
  const words = ['tone deaf', 'tone-deaf', 'tone deafness', 'beautiful', 'percentile',
    'talent', 'good', 'bad', 'great', 'perfect', 'excellent', 'poor', 'terrible', 'amazing', 'wrong'];
  const text = leaves(UI).map((p) => p.split('.').reduce((o, k) => o[k], UI)).join('\n').toLowerCase();
  for (const w of words) assert.ok(!new RegExp('\\b' + w + '\\b').test(text), `the strings say "${w}"`);
  for (const f of ['js/tools/sing-in-tune.js', 'js/tools/sing-in-tune-test.js', 'tool/content/ui/en/sing-in-tune-test.json',
    'tool/tests/sing-in-tune/logic.test.mjs', 'tool/tests/sing-in-tune/e2e.py']) {
    assert.ok(!/[\u2014\u2013]/.test(read(f)), f);
  }
  // Copy belongs in the ui file: the script's own strings are single-quoted
  // ids, classes and keys, never a sentence
  const code = SRC.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/["`]/.test(code.replace(/'[^'\n]*'/g, "''")), 'a double-quoted or template string in the script');
  for (const [, s] of code.matchAll(/'([^'\n]*)'/g)) assert.ok(!/[A-Za-z]+ [A-Za-z]+ [A-Za-z]+/.test(s), `'${s}' reads like copy`);
});

test('before the first tap: the mount point and mic.js only, the rest on the tap', () => {
  const statics = (src) => [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(statics(ENTRY), ['../audio/mic.js']);
  assert.deepEqual(statics(RUNS), ['../audio/mic.js']);
  const lazy = [...ENTRY.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(lazy.sort(), ['../audio/listener.js', '../audio/piano.js', '../audio/pitch.js', './sing-in-tune.js']);
  assert.ok(!/import\(/.test(RUNS), 'the runs load nothing more');
  const gz = (p) => gzipSync(readFileSync(join(REPO, p)), { level: 9 }).length;
  const before = gz('js/tools/sing-in-tune-test.js') + gz('js/audio/mic.js');
  const tap = gz('js/tools/sing-in-tune.js') + ['listener', 'piano', 'pitch', 'yin'].reduce((n, f) => n + gz(`js/audio/${f}.js`), 0);
  assert.ok(before <= 8 * 1024, `${before} bytes gzipped before the tap`);
  assert.equal(KEYS.range, 'scalita-range'); // vocal-range-test.js writes it
  console.log(`# before the tap ${before} B gzipped (sing-in-tune-test.js ${gz('js/tools/sing-in-tune-test.js')}, mic.js ${gz('js/audio/mic.js')}); on the tap ${tap} B more`);
});
