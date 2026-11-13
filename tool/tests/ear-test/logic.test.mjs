// js/tools/ear-run.js without a browser: the steps and how answers move
// through them, the pairs, the melodies and their changed note, what a
// result says, the strings, and the weight before the first tap; and the
// app's numbers and seeded run (tool/data/app/ear_check.json, written by
// the app's export) replayed here, so the two ear checks cannot drift.
//   node --test tool/tests/ear-test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  LEVELS, PASS, MISS, MELODIES, BAND, ROOTS, SCALE_OFF, MAJOR as SCALE, NOTE_MS, GAP_MS, SECOND_MS, TUNE_MS, BETWEEN_MS,
  ANSWER_MS, FEEDBACK_MS, answer, changeMelody, ladder, makeMelody, makePair, melodyItems, random, smallest, stepRead,
} from '../../../js/tools/ear-run.js';
import { KEYS, fmt } from '../../../js/tools/ear-test.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const ENTRY = read('js/tools/ear-test.js');
const RUNS = read('js/tools/ear-run.js');
const SRC = ENTRY + RUNS;
const UI = json('tool/content/ui/en/ear-test.json');
const COMMON = json('tool/content/ui/en/common.json');
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

const run = (answers) => answers.reduce((st, ok) => (st.done ? st : answer(st, ok)), ladder());

test('the steps halve from a semitone to 3 cents', () => {
  assert.deepEqual(LEVELS, [100, 50, 25, 12, 6, 3]);
  assert.ok(PASS === 3 && MISS === 2 && MELODIES === 4);
});

test('three right clear a step, two wrong at one step end the run', () => {
  assert.equal(smallest(run([true, true])), null);
  assert.equal(smallest(run([true, true, true])), 100);
  assert.equal(smallest(run([true, false, true, true])), 100);
  assert.equal(smallest(run([true, false, true, false])), null);
  assert.equal(run([true, false, true, false]).done, true);
  assert.equal(smallest(run([false, false])), null);
  assert.equal(run([false, false]).done, true);
  // a semitone, 50 and 25 heard, then two misses at 12
  const st = run([true, true, true, true, false, true, true, true, true, true, false, true, false]);
  assert.equal(smallest(st), 25);
  assert.equal(st.heard, 2);
  assert.equal(st.done, true);
  assert.equal(st.pairs, 13);
  // a miss at one step does not follow to the next one
  assert.equal(smallest(run([true, false, true, true, false, true, true, true, false, false])), 50);
  // every step heard, the run ends by itself
  const all = run(Array(18).fill(true));
  assert.equal(smallest(all), 3);
  assert.equal(all.done, true);
  assert.equal(all.pairs, 18);
  // no run takes more than four pairs a step
  for (let seed = 1; seed <= 200; seed++) {
    const r = random(seed);
    let st = ladder();
    while (!st.done) st = answer(st, r() < 0.7);
    assert.ok(st.pairs <= 4 * LEVELS.length, String(st.pairs));
  }
});

test('a guesser rarely gets far: 12 cents about once in a hundred runs', () => {
  const r = random(42);
  let fine = 0;
  const runs = 20000;
  for (let i = 0; i < runs; i++) {
    let st = ladder();
    while (!st.done) st = answer(st, r() < 0.5);
    if ((smallest(st) ?? 1000) <= 12) fine++;
  }
  assert.ok(Math.abs(fine / runs - 0.0095) < 0.004, String(fine / runs));
});

// The app's export (scalita_app test/web_export/ear_export.dart): its
// constants, and one seeded run replayed pair by pair and melody by melody
const APP = json('tool/data/app/ear_check.json');

test("the app's numbers: steps, pass, miss, band, keys, scale and timing", () => {
  assert.deepEqual(LEVELS, APP.levels);
  assert.equal(PASS, APP.pass);
  assert.equal(MISS, APP.miss);
  assert.deepEqual(BAND, APP.band);
  assert.deepEqual(ROOTS, APP.roots);
  assert.equal(MELODIES, APP.melodies);
  assert.deepEqual(SCALE, APP.scale);
  assert.equal(SCALE_OFF, APP.scaleOff);
  assert.deepEqual(
    { noteMs: NOTE_MS, gapMs: GAP_MS, secondRingMs: SECOND_MS, tuneMs: TUNE_MS, betweenMs: BETWEEN_MS,
      answerAfterMs: ANSWER_MS, feedbackMs: FEEDBACK_MS },
    APP.timing);
});

test("the app's seeded run draws the same pairs and melodies here", () => {
  const g = APP.golden;
  const r = random(g.seed);
  let st = ladder();
  let i = 0;
  while (!st.done) {
    const p = makePair(LEVELS[st.level], r);
    assert.deepEqual({ a: p.a, b: p.b, cents: p.cents, up: p.up, step: p.step }, g.pairs[i], `pair ${i}`);
    st = answer(st, g.answers[i]);
    i++;
  }
  assert.equal(i, g.pairs.length);
  assert.equal(smallest(st), g.smallest);
  assert.equal(st.heard + 1, g.heard);
  assert.deepEqual(melodyItems(r), g.melodies);
});

test('a pair is one note of the band and the same one moved by the step', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = random(seed);
    for (const step of LEVELS) {
      const p = makePair(step, r);
      assert.ok(p.a >= BAND[0] && p.a <= BAND[1]);
      assert.equal(p.b, p.a);
      assert.equal(p.cents, p.up ? step : -step);
    }
  }
});

test('melodies: five notes of the key, by steps and thirds, never a note twice in a row', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = random(seed);
    const root = ROOTS[0] + (seed % (ROOTS[1] - ROOTS[0] + 1));
    const m = makeMelody(r, root);
    assert.equal(m.length, 5);
    for (let i = 0; i < m.length; i++) {
      assert.ok(MAJOR.includes((m[i] - root) % 12) || m[i] - root === 12, `${m} in ${root}`);
      if (i) assert.ok(m[i] !== m[i - 1] && Math.abs(m[i] - m[i - 1]) <= 4, `${m}`);
    }
    const c = changeMelody(m, r, root);
    const moved = c.map((x, i) => x - m[i]).filter(Boolean);
    assert.equal(moved.length, 1, `${m} -> ${c}`);
    assert.equal(Math.abs(moved[0]), 1);
    const at = c.findIndex((x, i) => x !== m[i]);
    assert.ok(at > 0 && at < 4, 'a middle note moves');
    assert.ok(!MAJOR.includes((((c[at] - root) % 12) + 12) % 12), 'it leaves the key');
  }
});

test('four melody pairs, two the same and two not, every note playable', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const items = melodyItems(random(seed));
    assert.equal(items.length, MELODIES);
    assert.equal(items.filter((x) => x.same).length, MELODIES / 2);
    for (const it of items) {
      assert.equal(it.same, it.a.every((x, i) => x === it.b[i]));
      for (const m of [...it.a, ...it.b]) assert.ok(m >= 32 && m <= 91, String(m));
    }
  }
});

test('what a result says, against the 25 cents the app counts as off', () => {
  assert.equal(stepRead(null), 'none');
  assert.equal(stepRead(3), 'finer');
  assert.equal(stepRead(12), 'finer');
  assert.equal(stepRead(25), 'same');
  assert.equal(stepRead(50), 'wider');
  assert.equal(stepRead(100), 'wider');
  for (const k of ['none', 'finer', 'same', 'wider']) assert.ok(UI.result[k], k);
});

function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, prefix + k + '.') : [prefix + k]));
}

test('every string the script asks for exists, and every string in the file is used', () => {
  const asked = [...SRC.matchAll(/\bt\('([a-zA-Z0-9.]+)'\)/g)].map((m) => m[1]);
  const dynamic = [...SRC.matchAll(/\bt\('([a-zA-Z0-9.]+\.)' \+/g)].map((m) => m[1]);
  const get = (p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), UI);
  for (const p of asked) assert.ok(get(p) != null, `${p} is not in ui/en/ear-test.json`);
  for (const pre of dynamic) assert.ok(get(pre.slice(0, -1)), `${pre} is not in the file`);
  for (const p of leaves(UI)) {
    const used = asked.some((a) => p === a || p.startsWith(a + '.')) || dynamic.some((d) => p.startsWith(d))
      || [...SRC.matchAll(/t\(([^)]*)\)/g)].some((m) => m[1].includes("'" + p + "'"));
    assert.ok(used, `${p} is never shown`);
  }
  for (const k of [...SRC.matchAll(/\bc\('([a-zA-Z]+)'\)/g)].map((m) => m[1])) assert.ok(COMMON[k], `common.${k}`);
  for (const p of leaves(UI)) {
    const s = get(p);
    assert.equal(typeof s, 'string', p);
    for (const [, v] of s.matchAll(/\{(\w+)\}/g)) {
      assert.ok(SRC.includes(v + ':') || SRC.includes('{ ' + v) || SRC.includes(', ' + v), `${p}: {${v}} is never filled`);
    }
  }
  assert.equal(fmt('Step {n} of {total}', { n: 2, total: 6 }), 'Step 2 of 6');
});

test('no verdict on the ear or the voice, no dashes a reader takes for em dashes', () => {
  const words = ['tone deaf', 'tone-deaf', 'tone deafness', 'amusia', 'beautiful', 'percentile',
    'talent', 'good', 'bad', 'great', 'perfect', 'excellent', 'poor', 'terrible', 'amazing', 'wrong', 'normal'];
  const text = leaves(UI).map((p) => p.split('.').reduce((o, k) => o[k], UI)).join('\n').toLowerCase();
  for (const w of words) assert.ok(!new RegExp('\\b' + w + '\\b').test(text), `the strings say "${w}"`);
  for (const f of ['js/tools/ear-test.js', 'js/tools/ear-run.js', 'js/tools/share-ear.js', 'css/tool-ear.css',
    'tool/content/ui/en/ear-test.json', 'tool/tests/ear-test/logic.test.mjs']) {
    assert.ok(!/[\u2014\u2013]/.test(read(f)), f);
  }
  const code = SRC.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/["`]/.test(code.replace(/'[^'\n]*'/g, "''")), 'a double-quoted or template string in the script');
  for (const [, s] of code.matchAll(/'([^'\n]*)'/g)) assert.ok(!/[A-Za-z]+ [A-Za-z]+ [A-Za-z]+/.test(s), `'${s}' reads like copy`);
});

test('before the first tap: the mount point alone, no microphone ever', () => {
  const statics = (src) => [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(statics(ENTRY), []);
  assert.deepEqual(statics(RUNS), ['../site/wake-lock.js']);
  const lazy = [...ENTRY.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(lazy.sort(), ['../audio/piano.js', './ear-run.js', './share-ear.js']);
  assert.ok(!/getUserMedia|mic\.js|listener\.js/.test(SRC), 'nothing that opens a microphone');
  const gz = (p) => gzipSync(readFileSync(join(REPO, p)), { level: 9 }).length;
  const before = gz('js/tools/ear-test.js');
  assert.ok(before <= 4 * 1024, `${before} bytes gzipped before the tap`);
  assert.equal(KEYS.last, 'scalita-ear-last');
  console.log(`# before the tap ${before} B gzipped; on the tap ${gz('js/tools/ear-run.js') + gz('js/audio/piano.js') + gz('js/site/wake-lock.js')} B more`);
});
