// YIN parity: js/audio/yin.js against the app's own yin.dart, window by
// window (2048 samples every 1024, 44.1 kHz), on every take in fixtures.json.
//
//   node tool/tests/parity/parity.mjs
//
// Runs golden.dart first (needs `dart` on PATH and the app checkout next to
// this repo), writing the golden to SCALITA_SCRATCH or the temp folder,
// never into the repo. Passes when every take has 0 null or voiced
// mismatches and the largest difference is under 1e-6 cents.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Yin } from '../../../js/audio/yin.js';
import { HERE, fixtures, readWav, scratchDir, takesDir } from './takes.mjs';

const MAX_CENTS = 1e-6;
const dir = takesDir();
if (!dir) {
  console.log('SKIP: no takes folder (set SCALITA_TAKES or check out scalita_app next to this repo)');
  process.exit(0);
}
const missing = fixtures.takes.filter((f) => !existsSync(join(dir, f)));
if (missing.length) {
  console.error('FAIL: takes missing from ' + dir + ': ' + missing.join(', '));
  process.exit(1);
}

const out = scratchDir('parity');
mkdirSync(out, { recursive: true });
const golden = join(out, 'golden.jsonl');
const paths = fixtures.takes.map((f) => join(dir, f));
const run = spawnSync('dart', ['run', join(HERE, 'golden.dart'), '--out', golden, ...paths], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (run.status !== 0) {
  console.error('FAIL: golden.dart exited with ' + (run.error ? run.error.message : run.status));
  process.exit(1);
}

const want = new Map();
for (const line of readFileSync(golden, 'utf8').split('\n')) {
  if (!line) continue;
  const g = JSON.parse(line);
  want.set(g.f + '@' + g.o, g);
}

const yin = new Yin({ size: 2048, sampleRate: 44100, threshold: 0.2 });
let failed = 0, windows = 0, worstCents = 0;
for (const f of fixtures.takes) {
  const { rate, samples } = readWav(join(dir, f));
  if (rate !== 44100) throw new Error(f + ': not 44.1 kHz');
  const t = { windows: 0, missing: 0, nullMismatch: 0, voicedMismatch: 0, maxCents: 0, maxAp: 0 };
  for (let o = 0; o + 2048 <= samples.length; o += 1024) {
    t.windows++;
    const g = want.get(f + '@' + o);
    if (!g) {
      t.missing++;
      continue;
    }
    const r = yin.analyse(samples, o);
    if ((r === null) !== (g.hz === null)) {
      t.nullMismatch++;
      continue;
    }
    if (r === null) continue;
    if (r.voiced !== g.v) {
      t.voicedMismatch++;
      continue;
    }
    t.maxCents = Math.max(t.maxCents, Math.abs(1200 * Math.log2(r.frequency / g.hz)));
    t.maxAp = Math.max(t.maxAp, Math.abs(r.aperiodicity - g.ap));
  }
  const ok = t.missing === 0 && t.nullMismatch === 0 && t.voicedMismatch === 0 && t.maxCents < MAX_CENTS;
  if (!ok) failed++;
  windows += t.windows;
  worstCents = Math.max(worstCents, t.maxCents);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} windows ${t.windows} missing ${t.missing} null ${t.nullMismatch} `
    + `voiced ${t.voicedMismatch} maxCents ${t.maxCents.toExponential(2)} maxAp ${t.maxAp.toExponential(2)}`);
}
console.log(`${failed ? 'FAIL' : 'PASS'}: ${fixtures.takes.length} takes, ${windows} windows, `
  + `largest difference ${worstCents.toExponential(2)} cents (limit ${MAX_CENTS})`);
process.exit(failed ? 1 : 0);
