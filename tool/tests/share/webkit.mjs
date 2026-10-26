// The WebKit part of e2e.py, which starts it as
//   node tool/tests/share/webkit.mjs <playwright-core dir> <origin> <jobs.json>
// against the server e2e.py holds. Draws each job through fixture.html, as
// the Chromium part does, and prints one line of JSON: what WebKit drew.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const [core, origin, jobsPath] = process.argv.slice(2);
const { webkit } = createRequire(import.meta.url)(core);
const { cases, jobs } = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));

const browser = await webkit.launch({ headless: true });
const out = { version: browser.version(), logs: [], results: [] };
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && out.logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => out.logs.push('pageerror: ' + e.message));
  await page.goto(origin + '/tool/tests/share/fixture.html');
  await page.waitForFunction(() => window.share);
  await page.evaluate(() => window.share.ready);
  out.letterSpacing = await page.evaluate(() => 'letterSpacing' in CanvasRenderingContext2D.prototype);
  for (const j of jobs) {
    const r = await page.evaluate(([k, c, d, cs]) => window.share.run(k, c, d, cs, { png: true }), [j.kind, j.case, j.data, cases]);
    const d = j.ref ? await page.evaluate(([a, b]) => window.share.compare(a, b), [r.png, j.ref]) : null;
    out.results.push({ id: j.case.id, bad: r.bad, thin: r.thin, size: r.size, diff: d });
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(out));
