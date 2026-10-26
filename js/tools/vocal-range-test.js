/*
 * The vocal range test, its entry: the mount, the idle, in-app and error
 * panes, and the way in without a microphone in the page's aside slot. The
 * rest (the session, the listening view and its pitch trail, the keyboard
 * picker, the result, the piano and the share image) is vocal-range-run.js.
 * UI only; every word comes from the page data (ui/<loc>/vocal-range-test.json,
 * common.json, mic.json).
 *
 * Before a tap the page loads this file and mic.js. vocal-range-run.js,
 * listener.js and pitch.js load on Start (fetched early on the button's first
 * touch, key or focus), the run module alone on the keyboard path,
 * share-card.js with a result, piano.js on the tap that plays. Microphone or
 * piano, never both: the piano waits for the mic's tracks to stop, and Start
 * silences the piano first.
 *
 * mount(el, pageData, {createListener}) returns a handle (also el.rangeTest);
 * each change fires 'rangetest' on el: {state, phase, low, high, micOn}.
 * The last result stays in localStorage 'scalita-range': {low, high, date,
 * source} (MIDI, YYYY-MM-DD, 'mic' or 'manual'). Tests: tool/tests/range-test/.
 */

import { ERRORS, checkSupport, inAppBrowser, micIsLive } from '../audio/mic.js';

const TOOL = 'vocal-range-test';
export const STORE = 'scalita-range';

export const fill = (s, v = {}) =>
  String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

// Path data from the site's icon set (tool/templates/_parts.py): no words
export const ICON = {
  mic: ['M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
  lock: ['M7 10.5h10a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2z', 'M8 10.5V7.5a4 4 0 0 1 8 0v3'],
  keys: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 13v7', 'M15 13v7',
    'M7.5 4h3v8.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5z', 'M13.5 4h3v8.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5z'],
};

// An icon in currentColor, outlined or filled, hidden from screen readers
export function icon(paths, size, filled) {
  const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
  const a = { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', fill: filled ? 'currentColor' : 'none' };
  if (!filled) Object.assign(a, { stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  for (const k in a) s.setAttribute(k, a[k]);
  for (const d of paths) s.appendChild(document.createElementNS(ns, 'path')).setAttribute('d', d);
  return s;
}

export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(2)) if (c != null && c !== false) e.append(c);
  return e;
}

// Writes only a change, so a line read 20 times a second is left alone
export const setText = (el, t) => {
  if (el.textContent !== t) el.textContent = t;
};

// replaceChildren would print false and null: leave them out
export const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((c) => c != null && c !== false && c !== ''));

function readLast() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    if (v && Number.isInteger(v.low) && Number.isInteger(v.high) && v.low < v.high) return v;
  } catch {}
  return null;
}

export const newContext = () => {
  const A = globalThis.AudioContext || globalThis.webkitAudioContext;
  return new A({ latencyHint: 'interactive' });
};

export const resume = (c) => {
  try {
    const p = c.resume();
    if (p && p.catch) p.catch(() => {});
  } catch {}
};

const close = (c) => {
  try {
    c.close().catch(() => {});
  } catch {}
};

let runP = null;
const loadRun = () => runP || (runP = import('./vocal-range-run.js').catch((e) => {
  runP = null;
  throw e;
}));

export function mount(el, data = {}, hooks = {}) {
  if (el.rangeTest) return el.rangeTest;
  const S = data.strings || {};
  const U = S[TOOL] || {}, C = S.common || {}, M = S.mic || {};
  const T = (k, v) => fill(U[k], v);
  const notes = data.notes || {};
  const local = (m) => (notes[m] ? notes[m][0] : String(m));
  const intl = (m) => (notes[m] ? notes[m][1] : String(m));
  const named = (m) => (local(m) === intl(m) ? local(m) : local(m) + ' (' + intl(m) + ')');
  const nav = globalThis.navigator || {};
  const ua = nav.userAgent || '';
  // What the run module shares with this one: the strings, the panes, the
  // state the handle reports, and the steps either side can call
  const X = {
    el, data, hooks, U, C, M, T, local, intl, named, nav,
    span: (a, b, f = named) => T('rangeValue', { low: f(a), high: f(b) }),
    lang: data.lang || data.locale || 'en',
    platform: /Android/i.test(ua) ? 'android'
      : /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) ? 'ios' : 'desktop',
    state: null, run: 0, sess: null, micOn: false, settings: null, playing: null, last: readLast(),
    R: null, pending: null, panes: {},
  };

  el.classList.add('tool-panel');
  el.replaceChildren();
  for (const k of ['idle', 'listening', 'result', 'error', 'manual']) {
    X.panes[k] = h('div', { class: 'tool-panel__state tool-panel__state--' + k + ' rt-' + k, hidden: true });
    el.append(X.panes[k]);
  }
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  el.append(live);

  X.say = (text) => {
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 80);
  };
  X.emit = () => el.dispatchEvent(new CustomEvent('rangetest', {
    detail: { state: X.state, phase: X.sess && X.sess.phase, low: X.sess && X.sess.low, high: X.sess && X.sess.high, micOn: X.micOn },
  }));
  X.btn = (label, cls, onclick, extra) => h('button', { type: 'button', class: cls, onclick, ...extra }, label);
  X.lockline = () => h('p', { class: 'lockline' }, icon(ICON.lock, 14), h('span', null, C.nothingSent));
  X.canonical = () => {
    const c = document.querySelector('link[rel="canonical"]');
    return (c && c.href) || location.href.split('#')[0];
  };

  const run = () => loadRun().then((R) => X.R || (X.R = R.attach(X)));
  const pick = () => run().then((R) => R.picker(true), () => fail(ERRORS.FAILED, true));
  // a text link's look in every pane: its words are long, and they wrap
  const pickBtn = () => {
    const b = X.btn([icon(ICON.keys, 16), T('noMic')], 'rt-nomic', pick);
    b.addEventListener('pointerdown', () => run().catch(() => {}), { once: true });
    return b;
  };

  // The slot beside the stage (tool.py): a link to the page's keyboard help
  // that opens the picker instead, shown while the stage listens (every
  // other pane offers the keyboard itself)
  const main = el.closest('main');
  const slot = main && main.querySelector('[data-tool-slot="aside"]');
  if (slot) {
    const a = slot.querySelector('a[href="#keyboard"]')
      || slot.appendChild(h('a', { class: 'rt-aside', href: '#keyboard' }, icon(ICON.keys, 18), T('noMic')));
    a.addEventListener('click', (e) => {
      e.preventDefault();
      pick();
    });
  }

  X.show = (k, focus) => {
    for (const p in X.panes) X.panes[p].hidden = p !== k;
    X.state = k;
    el.dataset.state = k;
    if (slot) slot.hidden = k !== 'listening';
    const f = focus && X.panes[k].querySelector('[data-focus]');
    if (f) f.focus();
    X.emit();
  };

  // Silences whatever listens or plays, and drops a context a tap left waiting
  function halt() {
    X.run++;
    if (X.pending) close(X.pending);
    X.pending = null;
    if (X.R) X.R.halt();
  }

  function copyBtn() {
    const b = X.btn(C.copyLink, 'btn btn--secondary', () => {
      const url = X.canonical();
      const shown = () => {
        const i = h('input', { value: url, readonly: true, 'aria-label': C.copyLink, size: 28 });
        b.replaceWith(i);
        i.select();
      };
      try {
        navigator.clipboard.writeText(url).then(() => {
          b.textContent = C.copied;
          X.say(C.copied);
        }, shown);
      } catch {
        shown();
      }
    });
    return b;
  }
  X.copyBtn = copyBtn;

  function idle(focus) {
    halt();
    X.sess = null;
    const app = inAppBrowser(ua);
    const code = app ? null : checkSupport();
    if (code) return fail(code, focus);
    const k = [];
    if (app) {
      k.push(h('div', { class: 'rt-inapp' }, h('p', { 'data-focus': '', tabindex: '-1' }, C.openInBrowser),
        h('div', { class: 'tool-panel__actions' }, copyBtn(), X.btn(T('tryAnyway'), 'btn btn--secondary', start)),
        pickBtn()));
    } else {
      const go = X.btn([icon(ICON.mic, 20), C.start], 'btn btn--fill', start);
      const early = () => run().then((R) => R.preload()).catch(() => {});
      for (const ev of ['pointerdown', 'keydown', 'focus']) go.addEventListener(ev, early, { once: true });
      k.push(h('h3', { class: 'stage__title', 'data-focus': '', tabindex: '-1' }, T('title')),
        h('p', { class: 'rt-idle__intro' }, T('intro')),
        h('div', { class: 'rt-idle-art' }, h('div', { class: 'rt-idle-art__go' }, go, h('p', { class: 'pill pill--hint' }, C.allow))),
        h('div', { class: 'rt-idle__foot' }, pickBtn(), X.lockline()));
    }
    if (X.last) k.push(h('p', { class: 'rt-last' }, T('lastTimeLine', { range: X.span(X.last.low, X.last.high) })));
    put(X.panes.idle, k);
    X.show('idle', focus);
  }
  X.idle = idle;

  function start() {
    const code = checkSupport();
    if (code) return fail(code, true);
    halt();
    const my = ++X.run;
    let ctx;
    try {
      // Inside the tap: the context first, resumed, then the microphone
      ctx = X.pending = newContext();
      resume(ctx);
    } catch {
      return fail(ERRORS.FAILED, true);
    }
    run().then((R) => {
      if (X.pending !== ctx) return;
      X.pending = null;
      if (my !== X.run) return close(ctx);
      R.listen(ctx, my);
    }, () => my === X.run && fail(ERRORS.FAILED, true));
  }
  X.start = start;

  function stop() {
    idle(true);
    X.say(T('stopped'));
  }
  X.stop = stop;

  function fail(code, focus) {
    halt();
    X.sess = null;
    const again = code !== ERRORS.UNSUPPORTED && code !== ERRORS.IN_APP;
    put(X.panes.error,
      h('p', { class: 'tool-panel__error', role: 'alert', 'data-focus': '', tabindex: '-1', 'data-code': code },
        M[code] || M[ERRORS.FAILED]),
      h('div', { class: 'tool-panel__actions' },
        again && X.btn(C.tryAgain, 'btn btn--secondary', start),
        code === ERRORS.IN_APP && copyBtn()),
      pickBtn());
    X.show('error', focus);
  }
  X.fail = fail;

  const api = {
    get state() { return X.state; },
    get phase() { return X.sess && X.sess.phase; },
    get settings() { return X.settings; },
    get micOn() { return X.micOn; },
    get last() { return X.last; },
    get playing() { return !!X.playing; },
    micLive: () => micIsLive(),
    start,
    stop,
  };
  el.rangeTest = api;
  idle(false);
  // "No microphone? Pick your notes on a keyboard" from another page lands
  // on #keyboard: the picker opens (the focus stays where the page put it),
  // and once the page has loaded (until then the browser keeps its jump to
  // the reference's keyboard section) the stage comes into view: the first
  // screen as it was, where the stage fits on it
  if (location.hash === '#keyboard') {
    run().then((R) => R.picker(false), () => fail(ERRORS.FAILED, false));
    const stage = el.closest('.stage') || el;
    const view = () => requestAnimationFrame(() => {
      if (stage.getBoundingClientRect().bottom + scrollY <= innerHeight) scrollTo({ top: 0, behavior: 'instant' });
      else stage.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    if (document.readyState === 'complete') view();
    else addEventListener('load', view, { once: true });
  }
  return api;
}

function boot() {
  const els = document.querySelectorAll('[data-tool="' + TOOL + '"]');
  if (!els.length) return;
  let data = {};
  try {
    data = JSON.parse(document.getElementById('page-data').textContent);
  } catch {}
  for (const el of els) mount(el, data);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
