/*
 * The sing-in-tune test's mount point: build.py loads /js/tools/<toolId>.js
 * for a [data-tool] element. Before the first tap only this file and mic.js
 * arrive: the mode switcher, the voice choice and Start. The tap makes the
 * AudioContext (iOS wants it made and resumed inside the tap), then loads
 * sing-in-tune.js and the engines together, and sing-in-tune.js runs the
 * test; a sing result loads share-tune.js for its image. Every visible
 * string comes from the page data: ui/<loc>/sing-in-tune-test.json,
 * common.json and mic.json. The markup is the stage's (css/style.css) plus
 * the st- pieces of css/tool-tune.css.
 */

import { inAppBrowser, checkSupport } from '../audio/mic.js';

const TOOL = 'sing-in-tune-test';
// localStorage: this tool's last round and voice choice; the range test's
// last result (vocal-range-test.js), {low, high} as MIDI numbers
export const KEYS = { last: 'scalita-tune-last', voice: 'scalita-tune-voice', range: 'scalita-range' };

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

export function load(k) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export function store(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export function savedRange() {
  const v = load(KEYS.range);
  return v && Number.isInteger(v.low) && Number.isInteger(v.high) && v.low >= 21 && v.high <= 108 && v.high - v.low >= 4
    ? { low: v.low, high: v.high }
    : null;
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

// The icons the idle panel draws, from the site's shared set (24 x 24)
const ICONS = {
  mic: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3',
  lock: 'M7 10.5h10a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2zM8 10.5V7.5a4 4 0 0 1 8 0v3',
  play: 'M7 4.5v15l12.5-7.5z',
};

export function mount(el, pd, opts = {}) {
  if (el.__singInTune) return el.__singInTune;
  const strings = pd.strings || {};
  const S = strings[TOOL] || {};
  const C = strings.common || {};
  const lang = pd.lang || pd.locale || 'en';
  const t = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S) ?? '';
  const c = (k) => C[k] || '';
  const signed = new Intl.NumberFormat(lang, { signDisplay: 'exceptZero', maximumFractionDigits: 0 });
  const noMic = inAppBrowser() ? 'micInApp' : checkSupport();
  const uid = 'sit' + Math.random().toString(36).slice(2, 8);
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const states = ['idle', 'run', 'result', 'error'];
  const panes = states.map((k) => h('div', { class: 'tool-panel__state tool-panel__state--' + k, hidden: k !== 'idle' }));
  const [idleV, , , errV] = panes;
  // On a phone the mode switcher sits above the stage, wider in its head;
  // the voice choice sits beside How it works on a desktop
  const phone = matchMedia('(max-width: 599.98px)');
  const wide = matchMedia('(min-width: 960px)');
  const slot = document.querySelector('[data-tool-slot=aside]');
  const modes = h('div', { class: 'seg-group st-modes', role: 'group', 'aria-label': t('modes.label') },
    ...['sing', 'tuner', 'ear'].map((m) => h('button', {
      type: 'button', class: 'seg', 'data-mode': m, text: t('modes.' + m),
      onclick: () => {
        ui.mode = m;
        showIdle(true);
      },
    })));
  el.classList.add('tool-panel', 'st-panel');
  el.replaceChildren(...panes, live);

  // What sing-in-tune.js runs with: the strings, the panes, the run token
  // (a Stop or a new Start bumps it) and the context
  const ui = {
    el, pd, lang, t, c, h, fmt, panes, M: strings.mic || {}, keys: KEYS, load, store, I: ICONS,
    test: opts.test || globalThis.__scalitaTest || null,
    types: pd.voiceTypes || [], saved: savedRange(), voice: load(KEYS.voice), mode: 'sing',
    run: 0, ctx: null, stopAudio: null, onHide: null, vrow: null, vhere: null,
    names: (m) => (pd.notes && pd.notes[m]) || [String(m), String(m)],
    label(m) {
      const [l, i] = ui.names(m);
      return l === i ? l : l + ' (' + i + ')';
    },
    sign: (n) => signed.format(n),
    short: (n, sign) => fmt(t('units.short'), { n: sign ? signed.format(n) : String(n) }),
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
    lockline: () => h('p', { class: 'lockline' }, ui.icon(ICONS.lock, 14), c('nothingSent')),
    // The share image's module, after a result, where the build has one
    share: () => (pd.assets && pd.assets['/js/tools/share-tune.js'] ? import('./share-tune.js') : Promise.reject()),
    say(text) {
      live.textContent = '';
      setTimeout(() => { live.textContent = text; }, 60);
    },
    show(pane, focus) {
      const had = el.contains(document.activeElement);
      for (const p of panes) p.hidden = p !== pane;
      el.dataset.state = states[panes.indexOf(pane)];
      place();
      if (pane === idleV) el.style.minHeight = '';
      else ui.hold();
      if (focus && had) focus.focus({ preventScroll: true });
    },
    // Through a run the panel only grows: what is under it moves only when
    // the panel outgrows everything it held before, and never moves back
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
      if (!last || !Number.isFinite(last.off) || isNaN(d)) return '';
      const o = { day: 'numeric', month: 'short' };
      if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
      return fmt(t('result.last'), { label: c('lastTime'), cents: ui.short(last.off), date: new Intl.DateTimeFormat(lang, o).format(d) });
    },
    copyLink() {
      const b = ui.button(c('copyLink'), async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          b.textContent = c('copied');
        } catch {
          b.replaceWith(h('input', { class: 'chip', value: location.href, readonly: true, 'aria-label': c('copyLink') }));
        }
      });
      return b;
    },
    fail(code) {
      ui.run++;
      ui.stop();
      const retry = ui.button(c('tryAgain'), ui.start, 'btn-secondary btn--lg btn--strong');
      errV.replaceChildren(h('div', { class: 'stage__head' }), h('div', { class: 'st-idle' },
        h('p', { class: 'tool-panel__error', role: 'alert', 'data-code': code,
          text: code === 'pianoFailed' ? t('pianoFailed') : ui.M[code] || ui.M.micFailed || '' }),
        h('div', { class: 'tool-panel__actions' }, retry, code === 'micInApp' ? ui.copyLink() : null)));
      ui.show(errV, retry);
    },
    // The tap: the context now, synchronously; the rest on its way
    start() {
      const my = ++ui.run;
      ui.stop();
      el.style.minHeight = el.offsetHeight + 'px';
      ui.ctx = newContext();
      const failed = () => my === ui.run && ui.fail(ui.mode === 'ear' ? 'pianoFailed' : ui.ctx ? 'micFailed' : 'micUnsupported');
      if (!ui.ctx) return failed();
      Promise.all([import('./sing-in-tune.js'), import('../audio/listener.js'), import('../audio/piano.js'), import('../audio/pitch.js')])
        .then(([run, l, piano, pitch]) => my === ui.run
          && run.begin(ui, my, { createListener: l.createListener, prepare: l.prepare, piano, pitch }))
        .catch(failed);
    },
    showIdle,
  };

  // The mode switcher into the shown pane's head, or above the stage; the
  // voice choice into the slot beside How it works, or into the idle pane
  function place() {
    const head = panes.find((p) => !p.hidden).querySelector('.stage__head');
    modes.classList.toggle('seg-group--stretch', phone.matches);
    if (phone.matches) (el.closest('.stage') || el).before(modes);
    else if (head) head.prepend(modes);
    else modes.remove();
    const aside = slot && wide.matches;
    if (ui.vrow) {
      (aside ? slot : ui.vhere).append(ui.vrow);
      ui.vhere.hidden = aside;
    }
  }

  function voiceRow() {
    const { saved, types } = ui;
    const sel = h('select', { class: 'field', id: uid, onchange: () => store(KEYS.voice, (ui.voice = sel.value)) });
    if (saved) sel.append(h('option', { value: 'saved', text: fmt(t('voice.saved'), { low: ui.label(saved.low), high: ui.label(saved.high) }) }));
    sel.append(h('option', { value: 'any', text: t('voice.any') }));
    if (types.length) sel.append(h('optgroup', { label: t('voice.types') }, ...types.map((v) => h('option', { value: v.id, text: v.name }))));
    const v = ui.voice;
    if (!(v === 'any' || (v === 'saved' && saved) || types.some((x) => x.id === v))) ui.voice = saved ? 'saved' : 'any';
    sel.value = ui.voice;
    return h('p', { class: 'st-voice' }, h('label', { for: uid, text: t('voice.label') }), sel);
  }

  function showIdle(focusMode) {
    ui.halt(false);
    const mode = ui.mode;
    const ear = mode === 'ear';
    for (const b of modes.children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    const blocked = noMic && !ear;
    const go = ui.button(c('start'), ui.start, blocked ? 'btn-secondary btn--lg' : 'btn--fill', null,
      ui.icon(ear ? ICONS.play : ICONS.mic, 20, ear));
    const last = mode === 'sing' && ui.lastLine(load(KEYS.last));
    ui.vrow = mode === 'sing' ? voiceRow() : null;
    ui.vhere = ui.vrow && h('div');
    if (slot) slot.replaceChildren();
    idleV.replaceChildren(h('div', { class: 'stage__head' }), h('div', { class: 'st-idle' },
      h('p', { class: 'st-intro', text: t('intro.' + mode) }),
      ui.vhere,
      blocked ? h('p', { class: 'tool-panel__hint', text: noMic === 'micInApp' ? c('openInBrowser') : ui.M[noMic] || '' }) : null,
      h('div', { class: 'stage__actions' },
        h('div', { class: 'tool-panel__actions' }, blocked && noMic === 'micInApp' ? ui.copyLink() : null, go),
        ear ? null : ui.lockline(),
        last ? h('p', { class: 'st-last', text: last }) : null)));
    ui.show(idleV, focusMode ? null : go);
    if (focusMode) modes.querySelector('[data-mode=' + mode + ']').focus();
  }

  phone.addEventListener('change', place);
  wide.addEventListener('change', place);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && ui.ctx && ui.onHide) ui.onHide();
  });
  showIdle();
  el.__singInTune = ui;
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
