/*
 * The ear test's mount point: build.py loads /js/tools/<toolId>.js for a
 * [data-tool] element. Before the first tap only this file arrives: the
 * intro and Start. The tap makes the AudioContext (iOS wants it made and
 * resumed inside the tap), then loads ear-run.js and the piano, and
 * ear-run.js runs the test; a result loads share-ear.js for its image. No
 * microphone, ever. Every visible string comes from the page data:
 * ui/<loc>/ear-test.json and common.json. The markup is the stage's
 * (css/style.css), the st- pieces of css/tool-tune.css and the et- pieces
 * of css/tool-ear.css. A test may set data-rate on the mount to run faster.
 */

const TOOL = 'ear-test';
// localStorage: this tool's last result
export const KEYS = { last: 'scalita-ear-last' };

export const fmt = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));

export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

function load(k) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function store(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

// A silent sample plays first: iOS lets a context sound only once
// something has played inside a tap
function newContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    const c = new AC({ latencyHint: 'interactive' });
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, c.sampleRate);
    s.connect(c.destination);
    s.start(0);
    const p = c.resume();
    if (p && p.catch) p.catch(() => {});
    return c;
  } catch {
    return null;
  }
}

const PLAY = 'M7 4.5v15l12.5-7.5z';
const PHONES = 'M4 12a8 8 0 0 1 16 0v5a2 2 0 0 1-2 2h-1v-6h3M4 12h3v7H6a2 2 0 0 1-2-2z';

export function mount(el, pd, opts = {}) {
  if (el.__earTest) return el.__earTest;
  const strings = pd.strings || {};
  const S = strings[TOOL] || {};
  const C = strings.common || {};
  const lang = pd.lang || pd.locale || 'en';
  const t = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S) ?? '';
  const c = (k) => C[k] || '';
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const states = ['idle', 'run', 'result', 'error'];
  const panes = states.map((k) => h('div', { class: 'tool-panel__state tool-panel__state--' + k, hidden: k !== 'idle' }));
  const [idleV, , , errV] = panes;
  el.classList.add('tool-panel', 'st-panel', 'et-panel');
  el.replaceChildren(...panes, live);

  const ui = {
    el, pd, lang, t, c, h, fmt, panes, keys: KEYS, load, store,
    test: opts.test || globalThis.__scalitaTest || null,
    rate: Math.max(1, Number(el.dataset.rate) || 1),
    run: 0, ctx: null, stopAudio: null, onHide: null,
    short: (n) => fmt(t('units.short'), { n: String(n) }),
    icon(d, n = 18, fill) {
      const w = h('i');
      w.innerHTML = '<svg><path/></svg>';
      const s = w.firstChild;
      const a = { width: n, height: n, viewBox: '0 0 24 24', fill: fill ? 'currentColor' : 'none', stroke: 'currentColor',
        'stroke-width': fill ? 1.5 : 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
      for (const k in a) s.setAttribute(k, a[k]);
      s.firstChild.setAttribute('d', d);
      return s;
    },
    button: (text, onclick, cls = 'btn-secondary', extra, ic) =>
      h('button', { type: 'button', class: 'btn ' + cls, onclick, ...extra }, ic, text),
    share: () => (pd.assets && pd.assets['/js/tools/share-ear.js'] ? import('./share-ear.js') : Promise.reject()),
    say(text) {
      live.textContent = '';
      setTimeout(() => { live.textContent = text; }, 60);
    },
    show(pane, focus) {
      const had = el.contains(document.activeElement);
      for (const p of panes) p.hidden = p !== pane;
      el.dataset.state = states[panes.indexOf(pane)];
      if (pane === idleV) el.style.minHeight = '';
      else ui.hold();
      if (focus && had) focus.focus({ preventScroll: true });
    },
    hold() {
      el.style.minHeight = Math.max(el.offsetHeight, parseFloat(el.style.minHeight) || 0) + 'px';
    },
    stop() {
      if (ui.stopAudio) ui.stopAudio();
      if (ui.ctx) ui.ctx.close().catch(() => {});
      ui.ctx = null;
    },
    halt(toIdle = true) {
      ui.run++;
      ui.stop();
      if (toIdle) showIdle();
    },
    lastLine(last) {
      const d = new Date(last && last.at);
      if (!last || isNaN(d) || !(last.smallest == null || Number.isFinite(last.smallest))) return '';
      const o = { day: 'numeric', month: 'short' };
      if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
      return fmt(t('result.last'), { label: c('lastTime'), step: last.smallest == null ? t('result.lastNone') : ui.short(last.smallest),
        date: new Intl.DateTimeFormat(lang, o).format(d) });
    },
    fail(code) {
      ui.run++;
      ui.stop();
      const retry = ui.button(c('tryAgain'), ui.start, 'btn-secondary btn--lg btn--strong');
      errV.replaceChildren(h('div', { class: 'stage__head' }), h('div', { class: 'st-idle' },
        h('p', { class: 'tool-panel__error', role: 'alert', 'data-code': code, text: t('pianoFailed') }),
        h('div', { class: 'tool-panel__actions' }, retry)));
      ui.show(errV, retry);
    },
    // The tap: the context now, synchronously; the rest on its way
    start() {
      const my = ++ui.run;
      ui.stop();
      el.style.minHeight = el.offsetHeight + 'px';
      ui.ctx = newContext();
      const failed = () => my === ui.run && ui.fail('pianoFailed');
      if (!ui.ctx) return failed();
      Promise.all([import('./ear-run.js'), import('../audio/piano.js')])
        .then(([run, piano]) => my === ui.run && run.begin(ui, my, piano))
        .catch(failed);
    },
    showIdle,
  };

  function showIdle() {
    ui.halt(false);
    const go = ui.button(c('start'), ui.start, 'btn--fill', null, ui.icon(PLAY, 20, true));
    const last = ui.lastLine(load(KEYS.last));
    const pill = ((strings.templates || {}).tool || {}).noMic;
    idleV.replaceChildren(h('div', { class: 'stage__head' }, pill ? h('span', { class: 'pill pill--off' }, pill) : null),
      h('div', { class: 'st-idle' },
      h('p', { class: 'st-intro', text: t('intro') }),
      h('p', { class: 'et-tip' }, ui.icon(PHONES, 16), t('tip')),
      h('div', { class: 'stage__actions' },
        h('div', { class: 'tool-panel__actions' }, go),
        last ? h('p', { class: 'st-last', text: last }) : null)));
    ui.show(idleV, go);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && ui.ctx && ui.onHide) ui.onHide();
  });
  showIdle();
  el.__earTest = ui;
  return ui;
}

function boot() {
  const node = document.getElementById('page-data');
  if (!node) return;
  let pd;
  try {
    pd = JSON.parse(node.textContent);
  } catch {
    return;
  }
  for (const el of document.querySelectorAll('[data-tool="' + TOOL + '"]')) mount(el, pd);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
