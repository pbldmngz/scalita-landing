/*
 * voice-break.js: the voice break finder, the app's own method
 * (voice_break_finder_screen.dart). No microphone. The singer says lower or
 * higher voice (the app's question, without assuming gender), the piano
 * climbs a note every 2 s from the app's start (finderStartMidi, app 1.13.4:
 * about six under the break the range test's saved range points to, never
 * under its lowest note; without one, the answer's range low plus 8), and
 * they press when the voice shifts. The confirmation plays -2, 0, +2; a bit lower and
 * a bit higher move it by one inside C3 to C5; the result is the first shift,
 * the closest voice type by that note and the answer
 * (VoiceType.closestForPrimoAndGender), and its second shift.
 *
 * Mounts on [data-tool="voice-break-finder"]. Strings:
 * strings["voice-break-finder"], strings.common, and strings.templates.tool
 * (noMic, the pill, when the page has it). The result is kept in this
 * browser (BREAK_KEY) for the warm-up piano. Each step also reaches the
 * mount as a "scalita:finder" CustomEvent; it reads the range test's
 * result (RANGE_KEY) for the start, nothing else; data-rate="N" runs N times faster
 * (tests only). Looks: css/tool-player.css (.vb-*).
 */

export const BREAK_KEY = 'scalita-voice-break';
export const RANGE_KEY = 'scalita-range'; // {low, high}: the range test's result
export const PRIMO_MIN = 48; // passaggioPrimoMin, C3
export const PRIMO_MAX = 72; // passaggioPrimoMax, C5
export const STEP_MS = 2000;
// Range low per answer when no range is saved, before the app's +8: lower
// voices from E2 (the bass preset's floor), higher voices from C3 (the
// app's range when none is set)
export const RANGE_LOW = { lower: 40, higher: 48 };

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const fmt = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const BLACK = [1, 3, 6, 8, 10];
const isBlack = (m) => BLACK.includes(((m % 12) + 12) % 12);
// The site's icons (24 x 24): stop is filled
const STOP = 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z';
const REDO = 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5';
const ARROW = 'M5 12h14M13 6l6 6-6 6';

function icon(d, size, filled) {
  const t = document.createElement('template');
  t.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" ' + (filled ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"') + '><path d="' + d + '"/></svg>';
  return t.content.firstChild;
}

// VoiceType.closestForRange: the range's midpoint against each type's
// typical one, VoiceType order on a tie, the runner-up too within 2
export function closestForRange(types, low, high) {
  const mid = (low + high) / 2;
  const by = (types || [])
    .map((t, i) => [Math.abs((t.rangeLow + t.rangeHigh) / 2 - mid), i, t])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!by.length) return [];
  return by.length > 1 && by[1][0] - by[0][0] <= 2 ? [by[0][2], by[1][2]] : [by[0][2]];
}

// finderStartMidi (voice_break_finder_screen.dart): about six semitones
// under the first break the voice type, or the types closest to the range,
// expect, so the climb starts in chest voice; never under the lowest note,
// inside C3 to C5. Without either, eight above the lowest note (C3 if none)
export function finderStart({ low, high, type, types } = {}) {
  const lo = Number.isInteger(low) ? low : 48;
  const near = type ? [type] : Number.isInteger(low) && Number.isInteger(high) ? closestForRange(types, low, high) : [];
  let start = lo + 8;
  for (const t of near) start = Math.min(start, t.primo - 6);
  return clamp(start, clamp(lo, PRIMO_MIN, PRIMO_MAX), PRIMO_MAX);
}

// The range test's saved range, checked before use (as the warm-up piano
// checks it), or null
export function savedRange() {
  let r = null;
  try {
    r = JSON.parse(globalThis.localStorage.getItem(RANGE_KEY));
  } catch {}
  const low = r && r.low;
  const high = r && r.high;
  return Number.isInteger(low) && Number.isInteger(high) && low >= 21 && high <= 108 && high - low >= 5 ? { low, high } : null;
}

// Where the climb starts: from the saved range when there is one, else from
// the answer's range low
export const startNote = (lower, range, types) => (range
  ? finderStart({ low: range.low, high: range.high, types })
  : finderStart({ low: lower ? RANGE_LOW.lower : RANGE_LOW.higher }));

// The closest type by first shift among the answer's voices, VoiceType order
// winning a tie (strictly closer replaces)
export function matchVoiceType(primo, lower, types) {
  let best = null;
  let dist = 999;
  for (const t of types || []) {
    if (Boolean(t.isMaleVoice) !== Boolean(lower)) continue;
    const d = Math.abs(t.primo - primo);
    if (d < dist) {
      dist = d;
      best = t;
    }
  }
  return best;
}

let audio = null;
let pianoLoad = null;

function unlockAudio() {
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

const loadPiano = () =>
  (pianoLoad ||= import('../audio/piano.js').catch((e) => {
    pianoLoad = null;
    throw e;
  }));

// The screen stays on through the climb (js/site/wake-lock.js), fetched on
// the first Start, never with the page
let wakeLoad = null;
const awake = (key, on) => (on || wakeLoad)
  && (wakeLoad ||= import('../site/wake-lock.js').catch(() => null)).then((m) => m && m.keepAwake(key, on));

function store(value) {
  try {
    if (value === undefined) return JSON.parse(globalThis.localStorage.getItem(BREAK_KEY));
    globalThis.localStorage.setItem(BREAK_KEY, JSON.stringify(value));
  } catch {}
  return null;
}

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

export function mount(el, pd) {
  if (el.scalitaFinder) return el.scalitaFinder;
  const S = (pd.strings && pd.strings['voice-break-finder']) || {};
  const C = (pd.strings && pd.strings.common) || {};
  const T = (pd.strings && pd.strings.templates && pd.strings.templates.tool) || {};
  const types = pd.voiceTypes || [];
  const rate = Math.max(1, Number(el.dataset.rate) || 1);
  const note = (m) => (pd.notes && pd.notes[String(m)]) || [String(m), String(m)];
  const label = (m) => {
    const [l, i] = note(m);
    return l === i ? l : l + ' (' + i + ')';
  };
  const st = { lower: null, start: PRIMO_MIN, midi: null, primo: null, timer: null, token: 0, piano: null };

  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  // The note box: the note, its international name when the local one
  // differs, and its frequency
  const target = (locked) => {
    const name = h('span', { class: 'note-target__name' });
    const intl = h('span', { class: 'note-target__intl' });
    const hz = h('span', { class: 'note-target__hz' });
    return { box: h('div', { class: 'note-target notebox' + (locked ? ' note-target--locked' : '') }, name, intl, hz), name, intl, hz };
  };
  const setTarget = (t, m) => {
    const [l, i] = note(m);
    t.name.textContent = l;
    t.box.style.setProperty('--note-chars', l.length); // a long local name shrinks to fit
    t.intl.textContent = l === i ? '' : i;
    t.intl.hidden = l === i;
    t.hz.textContent = fmt(C.hz, { hz: (440 * 2 ** ((m - 69) / 12)).toLocaleString(pd.lang, { maximumFractionDigits: 1 }) });
  };
  const btn = (text, kind, onclick, ic) => h('button', { type: 'button', class: 'btn btn--' + kind, onclick }, ic, text);
  const actions = (...b) => h('div', { class: 'tool-panel__actions' }, ...b);
  // two choices on a phone: an even row or a full width stack (css/style.css)
  const pair = (...b) => h('div', { class: 'tool-panel__actions tool-panel__actions--pair' }, ...b);
  const p = (cls, text) => h('p', { class: cls }, text);

  // intro
  const last = p('vb-last', '');
  const startBtn = btn(S.letsGo, 'fill', () => show('voice'));
  const introError = h('p', { class: 'tool-panel__error', role: 'alert', hidden: true });
  // what to listen for is said where it is needed, under the climb
  const intro = h('div', { class: 'tool-panel__state tool-panel__state--idle' },
    p('vb-text', S.intro), last, introError, actions(startBtn));

  // voice question
  const lowerBtn = btn(S.lowerVoice, 'secondary btn--lg btn--strong vb-big', () => begin(true));
  const voice = h('div', { class: 'tool-panel__state', hidden: true },
    h('h3', { class: 'vb-title' }, S.whatDescribesYourVoice), p('vb-hint', S.voiceHint),
    actions(lowerBtn, btn(S.higherVoice, 'secondary btn--lg btn--strong vb-big', () => begin(false))));

  // the climb: the note box beside a staircase of every step, the one
  // sounding lit. No --listening modifier and no red dot: nothing listens
  const climbNote = target(false);
  const climbHint = p('stage__line', S.climbHelp);
  const feltBtn = btn(S.feltIt, 'fill', () => felt());
  const climbStatus = p('stage__status', S.firstShift);
  const stairs = h('div', { class: 'vb-climb', 'aria-hidden': 'true' });
  const climbing = h('div', { class: 'tool-panel__state', hidden: true },
    h('div', { class: 'stage__head vb-head' }, climbStatus, T.noMic && h('span', { class: 'pill pill--off' }, T.noMic)),
    h('div', { class: 'vb-main' }, stairs, climbNote.box), climbHint,
    h('div', { class: 'tool-panel__actions tool-panel__actions--wrap' }, feltBtn, btn(C.stop, 'secondary', () => show('intro'), icon(STOP, 16, true))));

  // confirm
  const confirmNote = target(true);
  const confirmTitle = h('h3', { class: 'vb-title' });
  const confirmMatch = p('vb-match', '');
  const yesBtn = btn(S.yes, 'fill', () => confirm());
  const confirming = h('div', { class: 'tool-panel__state', hidden: true },
    confirmTitle, confirmNote.box, confirmMatch,
    pair(btn(S.aBitLower, 'secondary', () => adjust(-1)), btn(S.aBitHigher, 'secondary', () => adjust(1))),
    p('vb-hint', S.confirmHelp), pair(yesBtn, btn(C.tryAgain, 'secondary', () => begin(st.lower), icon(REDO, 16))));

  // result: the value and facts, the zone on its keyboard, the notes, the
  // next steps (two columns on a wide stage). The app's offer is the band
  // right under the stage, with its Play and iPhone buttons, so the result
  // does not repeat it
  const value = p('result-card__value');
  const facts = h('dl', { class: 'result-card__facts' });
  const board = h('div', { class: 'keyboard', role: 'img' });
  const bed = h('div', { class: 'keyboard-bed vb-bed' }, board);
  const redoBtn = btn(S.redo, 'secondary', () => show('intro'), icon(REDO, 16));
  const result = h('div', { class: 'tool-panel__state tool-panel__state--result', hidden: true },
    h('div', { class: 'vb-result' },
      h('div', { class: 'result result-card' }, p('result-card__label', S.voiceBreak), value, facts),
      bed,
      h('div', { class: 'vb-notes' }, p('result-card__note', S.voiceBreakEducational), p('result-card__note', S.averages),
        p('result-card__note', S.saved)),
      pair(redoBtn, pd.links && pd.links['warm-up-piano']
        ? h('a', { class: 'btn btn--secondary btn--accent', href: pd.links['warm-up-piano'] }, S.useInPiano, icon(ARROW, 16)) : null)));

  const states = { intro, voice, climbing, confirming, result };
  const focusOf = { intro: startBtn, voice: lowerBtn, climbing: feltBtn, confirming: yesBtn, result: redoBtn };
  el.classList.add('tool-panel');
  el.replaceChildren(intro, voice, climbing, confirming, result, live);

  const emit = (detail) => el.dispatchEvent(new CustomEvent('scalita:finder', { detail }));

  function show(name, focus = true) {
    if (name !== 'climbing') stopClimb();
    if (name === 'intro' || name === 'voice') {
      st.token++;
      if (st.piano) st.piano.fadeAll(200);
    }
    if (name === 'intro') drawLast();
    for (const [k, node] of Object.entries(states)) node.hidden = k !== name;
    el.dataset.state = name;
    if (focus && focusOf[name]) focusOf[name].focus();
    emit({ type: 'state', state: name });
  }

  function drawLast() {
    const b = store();
    const t = b && types.find((x) => x.id === b.type);
    last.textContent = b && Number.isInteger(b.primo) && t ? fmt(S.lastResult, { note: label(b.primo), voiceType: t.name }) : '';
    last.hidden = !last.textContent;
  }

  function sound(m, velocity, when) {
    if (st.piano) st.piano.playNote(m, { velocity, when });
  }

  async function begin(lower) {
    st.lower = lower;
    stopClimb();
    introError.hidden = true;
    const ctx = unlockAudio();
    if (!ctx) return failed(S.noAudio);
    const token = ++st.token;
    awake(st, true);
    for (const [k, node] of Object.entries(states)) node.hidden = k !== 'climbing';
    el.dataset.state = 'climbing';
    climbStatus.textContent = C.loading;
    climbHint.textContent = S.climbHelp;
    st.start = startNote(lower, savedRange(), types);
    setTarget(climbNote, st.start);
    // one step per note the climb can sound, up to C5
    const n = PRIMO_MAX - st.start + 1;
    stairs.style.setProperty('--n', String(n));
    stairs.replaceChildren(...Array.from({ length: n }, (_, i) => h('span', { class: 'vb-step', style: '--i:' + i })));
    feltBtn.disabled = true;
    try {
      const piano = await loadPiano();
      if (token !== st.token) return;
      const man = pd.piano && pd.piano.manifest;
      if (!man) return failed(S.loadFailed);
      piano.init(man, pd.piano.base);
      piano.useContext(ctx);
      const ok = await piano.prepareRange(st.start - 2, PRIMO_MAX + 2, { margin: 0 });
      if (token !== st.token) return;
      if (!ok) return failed(S.loadFailed);
      st.piano = piano;
    } catch {
      return token === st.token && failed(S.loadFailed);
    }
    feltBtn.disabled = false;
    climbStatus.textContent = S.firstShift;
    show('climbing');
    st.midi = st.start;
    step();
    st.timer = setInterval(() => {
      if (st.midi >= PRIMO_MAX) {
        stopClimb();
        climbHint.textContent = S.climbTop;
        live.textContent = S.climbTop;
        return;
      }
      st.midi++;
      step();
    }, STEP_MS / rate);
  }

  function step() {
    setTarget(climbNote, st.midi);
    const at = st.midi - st.start;
    [...stairs.children].forEach((b, i) => (b.className = 'vb-step' + (i < at ? ' vb-step--past' : i === at ? ' vb-step--on' : '')));
    sound(st.midi, 0.7);
    emit({ type: 'note', midi: st.midi });
  }

  function stopClimb() {
    if (st.timer) clearInterval(st.timer);
    st.timer = null;
    awake(st, false);
  }

  function failed(text) {
    stopClimb();
    show('intro', false);
    introError.textContent = text;
    introError.hidden = false;
  }

  function drawConfirm() {
    const t = matchVoiceType(st.primo, st.lower, types);
    confirmTitle.textContent = fmt(S.youFeltSomethingAround, { note: label(st.primo) });
    confirmMatch.textContent = t ? fmt(S.matchesVoiceType, { voiceType: t.name }) : '';
    setTarget(confirmNote, st.primo);
  }

  function felt() {
    if (st.midi === null || feltBtn.disabled) return;
    stopClimb();
    st.primo = st.midi;
    drawConfirm();
    show('confirming');
    live.textContent = confirmTitle.textContent;
    const now = st.piano ? st.piano.getContext().currentTime : 0;
    sound(st.primo - 2, 0.5, now);
    sound(st.primo, 0.8, now + 0.7 / rate);
    sound(st.primo + 2, 0.5, now + 1.4 / rate);
    emit({ type: 'felt', midi: st.primo });
  }

  function adjust(d) {
    const next = clamp(st.primo + d, PRIMO_MIN, PRIMO_MAX);
    if (next === st.primo) return;
    st.primo = next;
    drawConfirm();
    live.textContent = confirmTitle.textContent;
    sound(next, 1);
    emit({ type: 'adjust', midi: next });
  }

  function confirm() {
    const t = matchVoiceType(st.primo, st.lower, types);
    if (!t) return;
    const primo = st.primo;
    const secondo = t.secondo;
    const [l, i] = note(primo);
    value.replaceChildren(l, ' ', l === i ? '' : h('small', null, i));
    facts.replaceChildren(
      h('div', null, h('dt', null, S.closestMatch), h('dd', null, t.name)),
      h('div', null, h('dt', null, S.secondShift), h('dd', null, label(secondo))));
    drawZone(primo, secondo);
    store({ primo, secondo, type: t.id, voice: st.lower ? 'lower' : 'higher', at: new Date().toISOString().slice(0, 10) });
    show('result');
    live.textContent = fmt(S.announce, { note: label(primo), voiceType: t.name });
    emit({ type: 'result', primo, secondo, voiceType: t.id });
  }

  function drawZone(primo, secondo) {
    let lo = primo - 7;
    let hi = secondo + 5;
    while (isBlack(lo)) lo--;
    while (isBlack(hi)) hi++;
    let whites = 0;
    const keys = [];
    for (let m = lo; m <= hi; m++) {
      const black = isBlack(m);
      if (!black) whites++;
      let cls = 'key' + (black ? ' key--black' : '');
      if (m >= primo && m <= secondo) cls += ' key--range';
      if (m === primo) cls += ' key--primo';
      if (m === secondo) cls += ' key--secondo';
      const k = h('span', { class: cls });
      if (!black && m % 12 === 0) k.textContent = note(m)[0];
      keys.push(k);
    }
    board.replaceChildren(...keys);
    for (const x of [board, bed]) x.style.setProperty('--whites', String(whites));
    board.setAttribute('aria-label', fmt(S.zone, { primo: label(primo), secondo: label(secondo) }));
  }

  const api = { show, begin, felt, adjust, confirm, get state() { return el.dataset.state; } };
  el.scalitaFinder = api;
  show('intro', false);
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
  for (const el of document.querySelectorAll('[data-tool="voice-break-finder"]')) mount(el, pd);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  else mountAll();
}
