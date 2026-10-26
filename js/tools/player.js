/*
 * player.js: the warm-up piano on [data-tool="player"][data-player], from
 * page data players[key] (tool/README.md): a routine, a scale or a chooser.
 * Voice types play the export's roots; the singer's own range runs the app's
 * resolver (scheduler.js) with the break the finder kept. piano.js loads on
 * the first Play. Strings: player, common, templates.tool.noMic (the pill).
 * Each event reaches the mount as "scalita:player"; data-rate="N" plays N
 * times faster (tests only).
 */
import { stepsFor, compile, estimateMinutes } from '../audio/scheduler.js';

export const RANGE_KEY = 'scalita-range'; // {low, high}: the range test's result
export const BREAK_KEY = 'scalita-voice-break'; // {primo, secondo}: the finder's
const CUSTOM_LOW = 36;
const CUSTOM_HIGH = 88;
const MIN_SPAN = 5;
const BLACK = [1, 3, 6, 8, 10];
// Icons (24 x 24), filled
const PLAY = 'M7 4.5v15l12.5-7.5z';
const STOP = 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z';

let audio = null;
let pianoLoad = null;
let sounding = null;

const fmt = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const isBlack = (m) => BLACK.includes(((m % 12) + 12) % 12);
const int = (x) => (Number.isInteger(x) ? x : null);

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

function icon(d) {
  const t = document.createElement('template');
  t.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="' + d + '"/></svg>';
  return t.content.firstChild;
}

export function readStore(key) {
  try {
    const v = JSON.parse(globalThis.localStorage.getItem(key));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// The one AudioContext, made and resumed inside the tap (iOS wants both)
export function unlockAudio() {
  if (audio && audio.state !== 'closed') {
    if (audio.state !== 'running' && audio.resume) audio.resume().catch(() => {});
    return audio;
  }
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    audio = new AC({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  const s = audio.createBufferSource();
  s.buffer = audio.createBuffer(1, 1, audio.sampleRate);
  s.connect(audio.destination);
  s.start(0);
  const p = audio.resume && audio.resume();
  if (p && p.catch) p.catch(() => {});
  return audio;
}

export const loadPiano = () =>
  (pianoLoad ||= import('../audio/piano.js').catch((e) => {
    pianoLoad = null;
    throw e;
  }));

// The scheduling half of the scheduler, fetched with the piano on the first Play
let playLoad = null;
const loadPlay = () =>
  (playLoad ||= import('../audio/scheduler-play.js').catch((e) => {
    playLoad = null;
    throw e;
  }));

// Saved results this browser holds, checked before use
export function savedRange() {
  const r = readStore(RANGE_KEY);
  let low = r && int(r.low);
  let high = r && int(r.high);
  if (low === null || high === null) return null;
  low = Math.max(CUSTOM_LOW, low);
  high = Math.min(CUSTOM_HIGH, high);
  return high - low >= MIN_SPAN ? { low, high } : null;
}

export function savedBreak() {
  const b = readStore(BREAK_KEY);
  const primo = b && int(b.primo);
  const secondo = b && int(b.secondo);
  return primo !== null && secondo !== null && primo >= 48 && primo <= 72 && secondo > primo && secondo <= 84 ? { primo, secondo } : null;
}

export function mount(el, pd) {
  if (el.scalitaPlayer) return el.scalitaPlayer;
  const players = (pd && pd.players) || {};
  const entry = players[el.dataset.player];
  if (!entry || !['routine', 'scale', 'chooser'].includes(entry.kind)) return null;
  const S = (pd.strings && pd.strings.player) || {};
  const C = (pd.strings && pd.strings.common) || {};
  const T = (pd.strings && pd.strings.templates && pd.strings.templates.tool) || {};
  const types = pd.voiceTypes || [];
  const items = entry.kind === 'chooser' ? (entry.items || []).filter((x) => x && (x.kind === 'routine' || x.kind === 'scale')) : [entry];
  if (!items.length) return null;
  const rate = Math.max(1, Number(el.dataset.rate) || 1);
  const label = (m) => {
    const n = pd.notes && pd.notes[String(m)];
    return n ? (n[0] === n[1] ? n[0] : n[0] + ' (' + n[1] + ')') : String(m);
  };

  const st = {
    item: items.find((x) => x.kind + ':' + x.id === entry.selected) || items[0],
    voice: null,
    custom: savedRange(),
    brk: savedBreak(),
    plan: null,
    handle: null,
    token: 0,
    picked: false, // a saved range opens chosen, its selects folded until asked for
    keys: new Map(),
    lit: [],
    lis: [],
  };
  const want = entry.preset || st.item.preset;
  if (types.some((t) => t.id === want)) st.voice = want;
  else if (st.custom) st.voice = 'custom';

  // ---- the parts
  const chooser = entry.kind === 'chooser' ? h('select', { class: 'field', onchange: (e) => choose(e.target.value) }) : null;
  if (chooser) {
    for (const [kind, name] of [['routine', S.routines], ['scale', S.scales]]) {
      const group = h('optgroup', { label: name });
      for (const x of items) if (x.kind === kind) group.append(h('option', { value: x.kind + ':' + x.id }, x.name || x.id));
      if (group.children.length) chooser.append(group);
    }
    chooser.value = st.item.kind + ':' + st.item.id;
  }
  const presets = h('div', { class: 'player__presets seg-group seg-group--scroll', role: 'group', 'aria-label': S.voiceLabel });
  const voiceBtns = [];
  for (const [id, name] of [...types.map((t) => [t.id, t.name]), ['custom', S.custom]]) {
    const b = h('button', { type: 'button', class: 'player__preset seg', 'aria-pressed': 'false', onclick: () => pickVoice(id) }, name);
    b.dataset.voice = id;
    voiceBtns.push(b);
    presets.append(b);
  }
  const options = (sel) => {
    for (let m = CUSTOM_LOW; m <= CUSTOM_HIGH; m++) sel.append(h('option', { value: String(m) }, label(m)));
    return sel;
  };
  const lowSel = options(h('select', { class: 'field', onchange: () => setCustom('low') }));
  const highSel = options(h('select', { class: 'field', onchange: () => setCustom('high') }));
  const custom = h('div', { class: 'player__custom', hidden: true },
    h('label', null, h('span', null, S.lowest), lowSel), h('label', null, h('span', null, S.highest), highSel));
  const meta = h('p', { class: 'player__meta' });
  const board = h('div', { class: 'keyboard', role: 'img' });
  const keyLine = h('p', { class: 'wp-key' });
  const unit = h('div', { class: 'wp-board' }, meta, h('div', { class: 'keyboard-bed' }, board), keyLine);
  const steps = h('ol', { class: 'player__steps' });
  const playBtn = h('button', { type: 'button', class: 'btn btn--fill', onclick: () => (st.handle || st.loading ? stop() : start()) });
  const live = h('p', { class: 'player__status', 'aria-live': 'polite' });
  const say = (text, bad) => {
    live.textContent = text;
    live.classList.toggle('wp-error', !!bad);
  };
  const top = (chooser || T.noMic) && h('div', { class: 'player__top' },
    chooser && h('label', { class: 'player__chooser' }, h('span', null, S.chooserLabel), chooser),
    T.noMic && h('span', { class: 'pill pill--off' }, T.noMic));
  el.classList.add('player');
  el.replaceChildren(...[top, presets, custom, unit, steps, h('div', { class: 'player__controls' }, live, playBtn)].filter(Boolean));

  // ---- the plan
  // A voice break the finder kept replaces the type's averages, as the
  // app's own finder does; the export's preset roots assume the averages
  function voiceArg() {
    const b = st.brk;
    if (st.voice === 'custom') return { low: st.custom.low, high: st.custom.high, primo: b && b.primo, secondo: b && b.secondo };
    const t = types.find((x) => x.id === st.voice);
    if (!t) return null;
    if (b) return { low: t.presetLow, high: t.presetHigh, primo: b.primo, secondo: b.secondo };
    return { preset: t.id, low: t.presetLow, high: t.presetHigh, primo: t.primo, secondo: t.secondo };
  }

  function replan() {
    const v = voiceArg();
    if (!v) return (st.plan = null);
    const list = stepsFor(st.item, v, pd.registers);
    const tl = compile(list, { skipFirstChord: st.item.kind === 'routine' });
    const pre = v.preset && st.item.presets && st.item.presets[v.preset];
    const minutes = st.item.kind === 'routine'
      ? (pre && pre.minutes) || estimateMinutes(list)
      : Math.max(1, Math.ceil(tl.durationMs / 60000));
    st.plan = { voice: v, steps: list, tl, minutes };
    return st.plan;
  }

  function drawBoard() {
    const p = st.plan;
    let lo = p ? Math.min(p.voice.low, p.tl.low === null ? p.voice.low : p.tl.low) - 1 : 48;
    let hi = p ? Math.max(p.voice.high, p.tl.high === null ? p.voice.high : p.tl.high) + 1 : 72;
    lo = Math.max(21, lo);
    hi = Math.min(108, hi);
    while (isBlack(lo) && lo > 21) lo--;
    while (isBlack(hi) && hi < 108) hi++;
    st.keys = new Map();
    st.lit = [];
    let whites = 0;
    const keys = [];
    for (let m = lo; m <= hi; m++) {
      const black = isBlack(m);
      if (!black) whites++;
      const inRange = p && m >= p.voice.low && m <= p.voice.high;
      const k = h('span', { class: 'key' + (black ? ' key--black' : '') + (inRange ? ' key--range' : '') });
      if (!black && m % 12 === 0) k.textContent = (pd.notes && pd.notes[String(m)] ? pd.notes[String(m)][0] : '');
      st.keys.set(m, k);
      keys.push(k);
    }
    board.replaceChildren(...keys);
    for (const x of [board, unit]) x.style.setProperty('--whites', String(whites));
    board.setAttribute('aria-label', fmt(S.keyboard, { low: label(p ? p.voice.low : lo), high: label(p ? p.voice.high : hi) }));
  }

  function drawSteps() {
    const it = st.item;
    st.lis = [];
    if (it.kind === 'routine') {
      for (const s of it.steps || []) {
        const sc = (it.scales && it.scales[s.scaleId]) || {};
        const li = h('li', null, h('strong', null, sc.name || s.scaleId), fmt(S.stepCard, { syllable: s.syllableLocal || s.syllable || '', tempo: s.tempo }));
        st.lis.push(li);
      }
    }
    steps.replaceChildren(...st.lis);
    steps.hidden = !st.lis.length;
  }

  function summary() {
    const p = st.plan;
    if (!p) return '';
    const line = st.item.kind === 'routine'
      ? fmt(S.routineSummary, { steps: p.steps.length, minutes: p.minutes })
      : fmt(S.scaleSummary, { keys: p.steps[0].roots.length, minutes: p.minutes });
    return st.brk ? line + '. ' + fmt(S.usingBreak, { note: label(st.brk.primo) }) : line;
  }

  function detail(i) {
    const it = st.item;
    if (it.kind === 'scale') {
      const s = st.plan.steps[0];
      return fmt(S.scaleDetail, { scale: it.name || it.id, tempo: s.tempo, direction: (S.directions || {})[s.direction] || s.direction });
    }
    const s = it.steps[i];
    const sc = (it.scales && it.scales[s.scaleId]) || {};
    return fmt(S.stepDetail, {
      scale: sc.name || s.scaleId,
      syllable: s.syllableLocal || s.syllable || '',
      tempo: s.tempo,
      style: (S.styles || {})[s.style] || s.style,
      direction: (S.directions || {})[s.direction] || s.direction,
    });
  }

  function idle() {
    const p = st.plan;
    meta.textContent = p ? summary() : '';
    say(p ? fmt(S.ready, { low: label(p.voice.low), high: label(p.voice.high) }) : S.pickVoice);
    keyLine.textContent = '';
  }

  function refresh() {
    voiceBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.voice === st.voice)));
    custom.hidden = st.voice !== 'custom' || !st.picked;
    if (st.custom) {
      lowSel.value = String(st.custom.low);
      highSel.value = String(st.custom.high);
    }
    replan();
    drawBoard();
    drawSteps();
    idle();
    // nothing to play until a voice type or a range is chosen
    playBtn.disabled = !st.plan;
  }

  // ---- the controls
  function choose(value) {
    const next = items.find((x) => x.kind + ':' + x.id === value);
    if (!next) return;
    stop();
    st.item = next;
    refresh();
  }

  function pickVoice(id) {
    stop();
    st.picked = true;
    if (id === 'custom' && !st.custom) {
      const t = types.find((x) => x.id === st.voice);
      st.custom = t
        ? { low: Math.max(CUSTOM_LOW, t.presetLow), high: Math.min(CUSTOM_HIGH, t.presetHigh) }
        : { low: 48, high: 72 };
    }
    st.voice = id;
    refresh();
  }

  function setCustom(which) {
    stop();
    let low = Number(lowSel.value);
    let high = Number(highSel.value);
    if (high - low < MIN_SPAN) {
      if (which === 'low') high = Math.min(CUSTOM_HIGH, low + MIN_SPAN);
      else low = Math.max(CUSTOM_LOW, high - MIN_SPAN);
      if (high - low < MIN_SPAN) which === 'low' ? (low = high - MIN_SPAN) : (high = low + MIN_SPAN);
    }
    st.custom = { low, high };
    refresh();
  }

  function setPlaying(on) {
    playBtn.replaceChildren(icon(on ? STOP : PLAY), on ? C.stop : C.play);
  }

  function light(list) {
    for (const k of st.lit) k.classList.remove('key--active');
    st.lit = [];
    for (const m of list) {
      const k = st.keys.get(m);
      if (k) {
        k.classList.add('key--active');
        st.lit.push(k);
      }
    }
  }

  function currentStep(i) {
    st.lis.forEach((li, j) => (j === i ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current')));
    const li = st.lis[i];
    if (li && steps.scrollTo) {
      const calm = globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      steps.scrollTo({ left: Math.max(0, li.offsetLeft - steps.offsetLeft - 8), behavior: calm ? 'auto' : 'smooth' });
    }
  }

  function onEvent(e) {
    const p = st.plan;
    if (e.type === 'count') {
      say(fmt(S.countIn, { n: e.n }));
    } else if (e.type === 'step') {
      currentStep(e.step);
      meta.textContent = detail(e.step);
      say(st.item.kind === 'routine' ? fmt(S.stepOf, { step: e.step + 1, steps: p.steps.length }) : '');
    } else if (e.type === 'key') {
      keyLine.textContent = fmt(S.keyOf, { key: e.key + 1, keys: e.keys, note: label(e.root) });
    } else if (e.type === 'note') {
      light([e.midi]);
    } else if (e.type === 'chord') {
      light(e.notes);
    } else if (e.type === 'rest') {
      light([]);
    } else if (e.type === 'pause') {
      light([]);
      keyLine.textContent = '';
      say(fmt(S.breathe, { seconds: e.left }));
    }
    el.dispatchEvent(new CustomEvent('scalita:player', { detail: e }));
  }

  function fail(text) {
    st.loading = false;
    st.handle = null;
    if (sounding === api) sounding = null;
    setPlaying(false);
    say(text, true);
  }

  async function start() {
    if (!st.plan) {
      say(S.pickVoice);
      voiceBtns[0].focus();
      return;
    }
    if (sounding && sounding !== api) sounding.stop();
    const ctx = unlockAudio();
    if (!ctx) return fail(S.noAudio);
    const token = ++st.token;
    sounding = api;
    st.loading = true;
    setPlaying(true);
    say(C.loading);
    keyLine.textContent = '';
    let piano;
    let play;
    try {
      [piano, { play }] = await Promise.all([loadPiano(), loadPlay()]);
    } catch {
      return token === st.token && fail(S.loadFailed);
    }
    if (token !== st.token) return;
    const man = pd.piano && pd.piano.manifest;
    if (!man) return fail(S.loadFailed);
    piano.init(man, pd.piano.base);
    piano.useContext(ctx);
    const tl = st.plan.tl;
    const ok = await piano.prepareRange(tl.low, tl.high, { margin: 0 });
    if (token !== st.token) return;
    if (!ok) return fail(S.loadFailed);
    st.loading = false;
    st.handle = play(tl, { piano, context: ctx, rate, onEvent });
    st.handle.done.then((why) => {
      if (token !== st.token || why !== 'end') return;
      st.handle = null;
      if (sounding === api) sounding = null;
      setPlaying(false);
      light([]);
      currentStep(-1);
      meta.textContent = summary();
      keyLine.textContent = '';
      say(S.done);
    });
  }

  function stop() {
    const was = st.handle || st.loading;
    st.token++;
    st.loading = false;
    if (st.handle) st.handle.stop();
    st.handle = null;
    if (sounding === api) sounding = null;
    if (!was) return;
    setPlaying(false);
    light([]);
    currentStep(-1);
    idle();
  }

  const api = { stop, start, get plan() { return st.plan; }, pickVoice, choose };
  el.scalitaPlayer = api;
  setPlaying(false);
  refresh();
  // the voice row scrolls on phones: open with the chosen voice in sight
  const on = voiceBtns.find((b) => b.dataset.voice === st.voice);
  if (on) presets.scrollLeft = on.offsetLeft - presets.offsetLeft - 40;
  return api;
}

function mountAll() {
  const node = document.getElementById('page-data');
  if (!node) return;
  let pd;
  try {
    pd = JSON.parse(node.textContent);
  } catch {
    return;
  }
  for (const el of document.querySelectorAll('[data-tool="player"][data-player]')) mount(el, pd);
  globalThis.addEventListener('pagehide', () => sounding && sounding.stop());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  else mountAll();
}
