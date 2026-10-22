// The pitch engine's weight and hygiene: under 12 KB gzipped in all, no
// dashes a reader would see as em dashes, no dependency outside js/audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { REPO } from './takes.mjs';

const FILES = ['yin.js', 'pitch.js', 'mic.js', 'capture.worklet.js', 'listener.js'];
const LIMIT = 12 * 1024;

test('the five files are under 12 KB gzipped together', () => {
  let total = 0;
  for (const f of FILES) {
    const n = gzipSync(readFileSync(join(REPO, 'js/audio', f)), { level: 9 }).length;
    total += n;
  }
  assert.ok(total < LIMIT, `${total} bytes gzipped`);
});

test('no em or en dashes, imports only from js/audio, root-absolute worklet path', () => {
  for (const f of FILES) {
    const src = readFileSync(join(REPO, 'js/audio', f), 'utf8');
    assert.ok(!/[\u2014\u2013]/.test(src), f);
    for (const m of src.matchAll(/^import .* from '([^']+)';$/gm)) assert.match(m[1], /^\.\/[a-z.]+\.js$/, f);
  }
  assert.match(readFileSync(join(REPO, 'js/audio/listener.js'), 'utf8'), /'\/js\/audio\/capture\.worklet\.js'/);
});
