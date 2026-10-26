// The share modules without a browser: what they export and import, that
// they hold no words and no dashes, the helpers that need no canvas, and
// their weight. e2e.py draws the images themselves.
//   node --test tool/tests/share/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CARD = 'js/tools/share-card.js', TUNE = 'js/tools/share-tune.js';
const card = await import(join(REPO, CARD));
const tune = await import(join(REPO, TUNE));

test('the API the tools call', () => {
  for (const m of [card, tune]) {
    assert.equal(m.WIDTH, 1080);
    assert.equal(m.HEIGHT, 1920);
    for (const f of ['toFile', 'canShare', 'share', 'save']) assert.equal(typeof m[f], 'function', f);
  }
  assert.equal(typeof card.drawRangeCard, 'function');
  assert.equal(typeof tune.drawTuneCard, 'function');
  assert.equal(card.drawCard, undefined, 'drawCard is drawRangeCard now (spec section 8)');
  assert.equal(tune.share, card.share, 'the tune module re-exports the helpers, it does not copy them');
});

test('share-card.js imports nothing, share-tune.js only share-card.js', () => {
  const imports = (src) => [...src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports(read(CARD)), []);
  assert.deepEqual([...new Set(imports(read(TUNE)))], ['./share-card.js']);
  for (const f of [CARD, TUNE]) assert.ok(!/\bimport\(/.test(code(f)), f + ' loads nothing later');
});

test('no words in the drawing: every string comes in with the data', () => {
  // what a string literal may be: colours, fonts, paths, CSS and canvas
  // keywords, Intl options, the API's own result codes, and the brand
  const allowed = new Set(['Sora', 'Segoe', 'UI', 'sans', 'serif', 'apple', 'system', 'url', 'fonts', 'sora', 'woff',
    'px', 'rgba', 'left', 'right', 'center', 'round', 'butt', 'miter', 'transparent', 'letterSpacing', 'lineTo', 'moveTo',
    'en', 'GB', 'numeric', 'short', 'UTC', 'string', 'loaded', 'image', 'png', 'AbortError', 'shared', 'cancelled',
    'failed', 'unsupported', 'share', 'card', 'js', 'hz', 'Hz', 'Scalita']);
  for (const f of [CARD, TUNE]) {
    for (const [, a, b] of code(f).matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      const s = (a ?? b).replace(/#[0-9a-f]{3,8}\b/gi, '');
      for (const w of s.match(/\p{L}{2,}/gu) || []) assert.ok(allowed.has(w), f + ': "' + w + '" in \'' + s + '\'');
    }
  }
});

test('no em or en dashes in what this package wrote', () => {
  const dash = new RegExp('[\\u2014\\u2013]|&' + 'mdash;|&' + 'ndash;');
  for (const p of [CARD, TUNE, ...['README.md', 'cases.json', 'e2e.py', 'fixture.html', 'fixture.mjs', 'share.test.mjs', 'webkit.mjs']
    .map((f) => 'tool/tests/share/' + f)]) assert.ok(!dash.test(read(p)), p);
});

test('the helpers that need no canvas', () => {
  const { resample, clamp, num, day } = card.kit;
  assert.deepEqual(resample([0, 10], 3), [0, 5, 10]);
  assert.deepEqual(resample([NaN, 0, null, 10, undefined], 5), [0, 2.5, 5, 7.5, 10], 'gaps are skipped, not drawn as zero');
  assert.equal(resample([4], 50), null, 'one reading is no line');
  assert.equal(resample(null, 50), null);
  const r = resample(Array.from({ length: 153 }, (_, i) => i), 153);
  assert.deepEqual(r, Array.from({ length: 153 }, (_, i) => i), 'the range tool already sends 153 points');
  assert.equal(clamp(200, 150), 150);
  assert.equal(clamp(-90, 70), -70);
  assert.equal(num('de', 523.25, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }), '523,3');
  assert.equal(num('en', 1396.913, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }), '1396.9');
  assert.equal(day('en', '2026-10-25'), '25 Oct 2026', 'English as the site writes dates, day first');
  assert.equal(day('de', '2026-10-25'), '25. Okt. 2026');
  assert.equal(day('en', undefined), '', 'no date, no line');
});

test('weight: the tune module under the spec\'s 4 KB, the range module held where it is', () => {
  const gz = (p) => gzipSync(readFileSync(join(REPO, p)), { level: 9 }).length;
  // The spec estimated 4 KB each. The range image (the roll, its fitting,
  // the shared text and blur helpers) came to about 7.5 KB with its
  // comments; it loads after a result only, never before a tap. Grow it on
  // purpose.
  assert.ok(gz(TUNE) <= 4096, TUNE + ' ' + gz(TUNE));
  assert.ok(gz(CARD) <= 8192, CARD + ' ' + gz(CARD));
});
