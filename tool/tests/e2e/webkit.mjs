// The WebKit part of run.py, which starts it as
//   node tool/tests/e2e/webkit.mjs <playwright-core dir> <origin> <config.json>
// against the server run.py holds. Prints one line of JSON: what WebKit saw.
// The page checks belong to run.py; this only drives the browser.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const [core, origin, configPath] = process.argv.slice(2);
const { webkit } = createRequire(import.meta.url)(core);
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// WebKit has no mute flag: every connection to a destination goes through a
// silent gain, so the graph runs and nothing reaches the speakers
const MUTE = `(() => {
  const connect = AudioNode.prototype.connect;
  const quiet = new WeakMap();
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
      let g = quiet.get(dest);
      if (!g) { g = dest.context.createGain(); g.gain.value = 0; connect.call(g, dest); quiet.set(dest, g); }
      return connect.call(this, g, ...rest);
    }
    return connect.call(this, dest, ...rest);
  };
})();`;

const out = { version: null, pages: {}, decode: {}, player: null };
const browser = await webkit.launch({ headless: true });
out.version = browser.version();

async function tab(init) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  for (const s of [MUTE, ...init]) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const t = { ctx, page, logs: [], requests: [] };
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && t.logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => t.logs.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => t.logs.push('failed ' + r.url() + ' ' + ((r.failure() || {}).errorText || '')));
  page.on('response', (r) => r.status() >= 400 && t.logs.push(r.status() + ' ' + r.url()));
  page.on('request', (r) => t.requests.push(new URL(r.url()).pathname));
  return t;
}
const audio = (t, from = 0) => t.requests.slice(from).filter((p) => p.startsWith('/audio/'));

try {
  for (const path of cfg.pages) {
    const t = await tab([]);
    await t.page.goto(origin + path);
    await t.page.waitForTimeout(800);
    const seen = await t.page.evaluate(() => ({
      mounts: [...document.querySelectorAll('[data-tool]')].map((el) => [...el.children].filter((c) => c.tagName !== 'NOSCRIPT').length),
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    out.pages[path] = { ...seen, logs: t.logs, audio: audio(t) };
    await t.ctx.close();
  }

  {
    const t = await tab([]);
    await t.page.goto(origin + '/404.html');
    out.decode = await t.page.evaluate(`(${cfg.decodeJs})(${JSON.stringify(cfg.decode)})`);
    await t.ctx.close();
  }

  if (cfg.piano) {
    const t = await tab([cfg.events, cfg.fast]);
    const pl = (out.player = { logs: t.logs });
    try {
      await t.page.goto(origin + cfg.piano);
      await t.page.waitForSelector('[data-tool="player"] .player__preset');
      await t.page.waitForTimeout(300);
      pl.audioBefore = audio(t);
      const mark = t.requests.length;
      await t.page.selectOption('[data-tool="player"] select', cfg.routine);
      await t.page.click(`[data-tool="player"] .player__preset[data-voice="${cfg.voice}"]`);
      await t.page.click('[data-tool="player"] .btn--fill');
      await t.page.waitForFunction(() => window.__ev.some((e) => e.event === 'scalita:player' && e.type === 'end'), null,
        { timeout: 180000 });
      pl.ended = true;
      const ev = await t.page.evaluate(() => window.__ev);
      pl.keys = ev.filter((e) => e.event === 'scalita:player' && e.type === 'key').map((e) => [e.step, e.root]);
      pl.audioAfter = audio(t, mark);
    } catch (e) {
      pl.error = String(e).split('\n')[0];
      pl.audioAfter = pl.audioAfter || [];
    }
    await t.ctx.close();
  }
} finally {
  await browser.close();
}
process.stdout.write(JSON.stringify(out) + '\n');
