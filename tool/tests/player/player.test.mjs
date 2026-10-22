// The warm-up piano's and the voice break finder's logic, no browser.
//
//   node --test tool/tests/player/*.test.mjs
//
// The finder's voice type against voice_type.dart (cases worked out by hand
// from its primo table, then every exported vector), its start note, what
// the player trusts from localStorage, and the strings: every key the
// scripts read exists in the English ui files, and nothing in them is a
// verdict or an em dash. Sizes stay inside the page budget.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchVoiceType, startNote, PRIMO_MIN, PRIMO_MAX, BREAK_KEY } from '../../../js/tools/voice-break.js';
import { savedRange, savedBreak, RANGE_KEY, BREAK_KEY as PLAYER_BREAK_KEY } from '../../../js/tools/player.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(site, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const VOICES = json('tool/data/app/voice_types.json').map((v) => ({ ...v, name: v.names.en }));
const VECTORS = json('tool/data/app/voice_type_vectors.json').closestForPrimoAndGender;

test('finder: the closest type by first shift and voice, worked out from voice_type.dart', () => {
  // primo: soprano 65, mezzo 64, contralto 62 | tenor 62, baritone 59, bass 56
  const cases = [
    [48, true, 'bass'], [56, true, 'bass'], [57, true, 'bass'], [58, true, 'baritone'],
    [59, true, 'baritone'], [60, true, 'baritone'], [61, true, 'tenor'], [62, true, 'tenor'], [72, true, 'tenor'],
    [48, false, 'contralto'], [62, false, 'contralto'], [63, false, 'mezzoSoprano'], // a tie: VoiceType order
    [64, false, 'mezzoSoprano'], [65, false, 'soprano'], [72, false, 'soprano'],
  ];
  for (const [primo, lower, want] of cases) assert.equal(matchVoiceType(primo, lower, VOICES).id, want, `${primo} ${lower}`);
  const second = { soprano: 77, mezzoSoprano: 76, contralto: 74, tenor: 67, baritone: 64, bass: 61 };
  for (const v of VOICES) assert.equal(v.secondo, second[v.id]);
});

test('finder: every exported closestForPrimoAndGender case', () => {
  assert.ok(VECTORS.length > 90);
  for (const v of VECTORS) assert.equal(matchVoiceType(v.primo, v.isMaleVoice, VOICES).id, v.type, JSON.stringify(v));
});

test('finder: the climb starts at range low plus 8, inside C3 to C5', () => {
  assert.equal(startNote(true), 48);
  assert.equal(startNote(false), 56);
  assert.equal(PRIMO_MIN, 48);
  assert.equal(PRIMO_MAX, 72);
  // below the lowest first shift each answer can match
  assert.ok(startNote(true) < Math.min(...VOICES.filter((v) => v.isMaleVoice).map((v) => v.primo)));
  assert.ok(startNote(false) < Math.min(...VOICES.filter((v) => !v.isMaleVoice).map((v) => v.primo)));
});

function withStorage(items, fn) {
  const before = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k in items ? items[k] : null), setItem() {} };
  try {
    return fn();
  } finally {
    globalThis.localStorage = before;
  }
}

test('player: what it takes from this browser is checked first', () => {
  assert.equal(PLAYER_BREAK_KEY, BREAK_KEY);
  withStorage({}, () => {
    assert.equal(savedRange(), null);
    assert.equal(savedBreak(), null);
  });
  withStorage({ [RANGE_KEY]: '{"low":45,"high":69}', [BREAK_KEY]: '{"primo":59,"secondo":64,"type":"baritone"}' }, () => {
    assert.deepEqual(savedRange(), { low: 45, high: 69 });
    assert.deepEqual(savedBreak(), { primo: 59, secondo: 64 });
  });
  withStorage({ [RANGE_KEY]: '{"low":30,"high":95}' }, () => assert.deepEqual(savedRange(), { low: 36, high: 88 }));
  withStorage({ [RANGE_KEY]: '{"low":60,"high":62}', [BREAK_KEY]: '{"primo":40,"secondo":64}' }, () => {
    assert.equal(savedRange(), null);
    assert.equal(savedBreak(), null);
  });
  withStorage({ [RANGE_KEY]: 'not json', [BREAK_KEY]: '{"primo":"59"}' }, () => {
    assert.equal(savedRange(), null);
    assert.equal(savedBreak(), null);
  });
  // storage that throws, as in a private window
  const before = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); } };
  try {
    assert.equal(savedRange(), null);
  } finally {
    globalThis.localStorage = before;
  }
});

const UI = {
  player: json('tool/content/ui/en/player.json'),
  finder: json('tool/content/ui/en/voice-break-finder.json'),
  common: json('tool/content/ui/en/common.json'),
};

test('strings: every key the scripts read is in the English ui files', () => {
  const uses = (file, name) => [...read(file).matchAll(new RegExp('\\b' + name + '\\.(\\w+)', 'g'))].map((m) => m[1]);
  for (const k of uses('js/tools/player.js', 'S')) assert.ok(k in UI.player, `player.json: ${k}`);
  for (const k of uses('js/tools/voice-break.js', 'S')) assert.ok(k in UI.finder, `voice-break-finder.json: ${k}`);
  for (const f of ['js/tools/player.js', 'js/tools/voice-break.js']) {
    for (const k of uses(f, 'C')) assert.ok(k in UI.common, `common.json: ${k} (${f})`);
  }
  for (const s of ['struck', 'normal', 'smooth']) assert.ok(UI.player.styles[s]);
  for (const d of ['normal', 'inverted', 'mirror']) assert.ok(UI.player.directions[d]);
});

test('strings: placeholders are the ones the scripts fill', () => {
  const want = {
    player: { ready: ['low', 'high'], routineSummary: ['steps', 'minutes'], scaleSummary: ['keys', 'minutes'],
      stepCard: ['syllable', 'tempo'], stepDetail: ['scale', 'syllable', 'tempo', 'style', 'direction'],
      scaleDetail: ['scale', 'tempo', 'direction'], stepOf: ['step', 'steps'], keyOf: ['key', 'keys', 'note'], usingBreak: ['note'],
      countIn: ['n'], breathe: ['seconds'], keyboard: ['low', 'high'] },
    finder: { lastResult: ['note', 'voiceType'], youFeltSomethingAround: ['note'], matchesVoiceType: ['voiceType'],
      zone: ['primo', 'secondo'], announce: ['note', 'voiceType'] },
  };
  for (const [file, keys] of Object.entries(want)) {
    for (const [k, vars] of Object.entries(keys)) {
      const got = [...UI[file][k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(got, [...vars].sort(), `${file}.${k}`);
    }
    for (const [k, v] of Object.entries(UI[file])) {
      if (typeof v === 'string' && !(k in keys)) assert.ok(!/\{\w+\}/.test(v), `${file}.${k} has a placeholder nothing fills`);
    }
  }
});

test('strings and code: no em dash, no verdict', () => {
  const files = ['js/tools/player.js', 'js/tools/voice-break.js', 'js/tools/voice-break-finder.js', 'js/audio/scheduler.js',
    'tool/content/ui/en/player.json', 'tool/content/ui/en/voice-break-finder.json'];
  const dash = String.fromCharCode(0x2014);
  for (const f of files) assert.ok(!read(f).includes(dash), f);
  const text = JSON.stringify([UI.player, UI.finder]).toLowerCase();
  for (const w of ['tone deaf', 'tone-deaf', 'beautiful', 'percentile']) assert.ok(!text.includes(w), w);
});

test('budget: what a page loads before the first tap stays under 15 KB gzipped', () => {
  const gz = (f) => gzipSync(read(f), { level: 9 }).length;
  const player = gz('js/tools/player.js') + gz('js/audio/scheduler.js');
  const finder = gz('js/tools/voice-break-finder.js') + gz('js/tools/voice-break.js');
  assert.ok(player < 15 * 1024, `player ${player}`);
  assert.ok(finder < 15 * 1024, `finder ${finder}`);
  // piano.js is imported on the first tap, never before
  for (const f of ['js/tools/player.js', 'js/tools/voice-break.js']) {
    assert.ok(!/^import .*piano\.js/m.test(read(f)), `${f} imports piano.js up front`);
  }
});
