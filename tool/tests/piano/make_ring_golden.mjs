// The ring-time golden: PianoSampler.ringForNote and ringTimeMsForBpm, run as
// the app's own Dart over a table of durations and tempos.
//
//   node tool/tests/piano/make_ring_golden.mjs [APP_DIR]   rewrite ring_golden.json
//
// piano_sampler.dart imports Flutter, so it cannot run under plain `dart`.
// The two methods and the class's int constants are pure, though: they are
// lifted out of the source as text, wrapped in a class of the same name and
// run with `dart run`. The test (piano.test.mjs) checks the JS port against
// the saved table, and against a fresh Dart run when the app and dart exist.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP_DIR = process.env.SCALITA_APP || fileURLToPath(new URL('../../../../scalita_app', import.meta.url));
export const SOURCE = 'lib/core/audio/piano_sampler.dart';
export const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'ring_golden.json');

const edges = [-50, 0, 1, 2, 19, 20, 21, 199, 239, 240, 241, 250, 799, 800, 801, 7599, 7600, 7601, 7999, 8000, 8001, 20000];
export const DURATIONS = [...new Set([...edges, ...Array.from({ length: 181 }, (_, i) => i * 50)])].sort((a, b) => a - b);
export const BPMS = Array.from({ length: 401 }, (_, i) => i);

function method(src, signature) {
  const i = src.indexOf(signature);
  if (i < 0) throw new Error('not found in ' + SOURCE + ': ' + signature);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced braces after ' + signature);
}

// The table from the app's Dart, or null when the app or dart is missing.
export function dartTable(appDir = APP_DIR) {
  const file = join(appDir, SOURCE);
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  const consts = [...src.matchAll(/static const int (\w+) = (-?\d+);/g)];
  const program = `import 'dart:convert';
class PianoSampler {
${consts.map((m) => '  ' + m[0]).join('\n')}
  ${method(src, 'static (int ringMs, int fadeMs) ringForNote(')}
  ${method(src, 'static int ringTimeMsForBpm(')}
}
void main() {
  final durations = ${JSON.stringify(DURATIONS)};
  final bpms = ${JSON.stringify(BPMS)};
  print(jsonEncode({
    'ringForNote': [for (final d in durations) [d, PianoSampler.ringForNote(d).$1, PianoSampler.ringForNote(d).$2]],
    'ringTimeMsForBpm': [for (final b in bpms) [b, PianoSampler.ringTimeMsForBpm(b)]],
  }));
}
`;
  const dir = mkdtempSync(join(tmpdir(), 'ring-golden-'));
  try {
    writeFileSync(join(dir, 'ring.dart'), program);
    let stdout;
    try {
      stdout = execFileSync('dart', ['run', join(dir, 'ring.dart')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
    const table = JSON.parse(stdout);
    return {
      source: SOURCE,
      sourceSha256: createHash('sha256').update(src).digest('hex'),
      constants: Object.fromEntries(consts.map((m) => [m[1], Number(m[2])])),
      ...table,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// One row per line, so a change shows up as a readable diff
export function format(golden) {
  const rows = (list) => '[\n    ' + list.map((r) => JSON.stringify(r)).join(',\n    ') + '\n  ]';
  return (
    '{\n' +
    `  "source": ${JSON.stringify(golden.source)},\n` +
    `  "sourceSha256": ${JSON.stringify(golden.sourceSha256)},\n` +
    `  "constants": ${JSON.stringify(golden.constants)},\n` +
    `  "ringForNote": ${rows(golden.ringForNote)},\n` +
    `  "ringTimeMsForBpm": ${rows(golden.ringTimeMsForBpm)}\n` +
    '}\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const golden = dartTable(process.argv[2] || APP_DIR);
  if (!golden) {
    console.error('needs the app at ' + (process.argv[2] || APP_DIR) + ' and dart on PATH');
    process.exit(1);
  }
  writeFileSync(GOLDEN, format(golden));
  console.log('wrote ' + GOLDEN + ': ' + golden.ringForNote.length + ' durations, ' + golden.ringTimeMsForBpm.length + ' tempos');
}
