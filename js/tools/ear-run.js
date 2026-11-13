/*
 * The ear test once Start is tapped, loaded with the piano by ear-test.js
 * (the idle panel). The piano only: the microphone is never asked for.
 *   steps     two notes, lower or higher, the step between them getting
 *             smaller: 100 cents (a semitone), then 50, 25, 12, 6 and 3.
 *             A step is heard once three of its pairs are answered right,
 *             and the test moves on; two wrong at one step end this part
 *   melodies  two short melodies, the same or different: four pairs, two
 *             of each, the different one with one note moved off the key
 *             (the shape of the Montreal battery's scale test)
 * The result is the smallest step heard and how many melodies were told
 * apart: a measurement, never a verdict. Its image is share-ear.js's.
 * The app is the source of these numbers: its export writes them, with one
 * seeded run, to tool/data/app/ear_check.json, and logic.test.mjs holds
 * this file to it, so the app's ear check and this one cannot drift.
 * Tests may set globalThis.__scalitaTest before the page loads: seed, and
 * events, where every question is pushed as it is asked (ask: its step and
 * direction, or whether the melodies are the same), every answer (pair,
 * melody) and the result.
 */

import { keepAwake } from '../site/wake-lock.js';

export const LEVELS = [100, 50, 25, 12, 6, 3]; // cents
export const PASS = 3; // right answers that clear a step: a guesser clears one about 31% of the time
export const MISS = 2; // wrong answers that end the steps
export const MELODIES = 4;
export const BAND = [55, 67]; // G3 to G4: where most ears tell pitch best and every voice sits
export const ROOTS = [53, 60]; // the melodies' keys, F3 to C4: each spans an octave up from its key
export const SCALE_OFF = 25; // cents: a sung note further than this is off in the app
export const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
export const NOTE_MS = 900; // a pair's first note
export const GAP_MS = 1000; // from one note's start to the next
export const SECOND_MS = 1300; // a pair's second note rings longer
export const TUNE_MS = 430; // a melody's notes
export const BETWEEN_MS = 1100; // the silence between the two melodies
export const ANSWER_MS = 150; // the answers open this long after the last note starts
export const FEEDBACK_MS = 1100; // an answer stays on screen
const BLANK = String.fromCharCode(160);

export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// One pair at a step: a note of the band, then the same note step cents up
// or down, the same sample stretched, a semitone too, so no step has a
// change of sample (timbre or loudness) to give it away
export function makePair(step, rand, [lo, hi] = BAND) {
  const up = rand() < 0.5;
  const a = pick(rand, lo, hi);
  return { a, b: a, cents: up ? step : -step, up, step };
}

// The steps' state: where the run is, what it has heard. answer() returns
// the next state; done once a step is missed twice or the last one is heard
export const ladder = () => ({ level: 0, right: 0, wrong: 0, heard: -1, pairs: 0, done: false });

export function answer(st, ok) {
  const s = { ...st, pairs: st.pairs + 1, right: st.right + (ok ? 1 : 0), wrong: st.wrong + (ok ? 0 : 1) };
  if (s.right >= PASS) {
    s.heard = s.level;
    s.level++;
    s.right = s.wrong = 0;
    s.done = s.level >= LEVELS.length;
  } else if (s.wrong >= MISS) s.done = true;
  return s;
}

export const smallest = (st) => (st.heard >= 0 ? LEVELS[st.heard] : null);

// A five-note melody in a major key on root: it starts low in the scale and
// moves by a step or a third, never the same note twice in a row
export function makeMelody(rand, root) {
  let d = pick(rand, 0, 2);
  const out = [d];
  while (out.length < 5) {
    const moves = [-2, -1, 1, 2].filter((m) => d + m >= 0 && d + m < MAJOR.length);
    d += moves[Math.floor(rand() * moves.length)];
    out.push(d);
  }
  return out.map((x) => root + MAJOR[x]);
}

// The melody with one of its middle notes moved a semitone off the key, to
// a note the key does not hold and its neighbours are not
export function changeMelody(notes, rand, root) {
  const inKey = (m) => MAJOR.includes((((m - root) % 12) + 12) % 12);
  const at = pick(rand, 1, notes.length - 2);
  const tries = rand() < 0.5 ? [1, -1] : [-1, 1];
  for (const k of [at, ...[1, 2, 3].filter((i) => i !== at)]) {
    for (const d of tries) {
      const m = notes[k] + d;
      if (!inKey(m) && m !== notes[k - 1] && m !== notes[k + 1]) return notes.map((x, i) => (i === k ? m : x));
    }
  }
  return notes.map((x, i) => (i === at ? x + 1 : x));
}

// Four melody pairs, two the same and two not, in a shuffled order, each in
// its own key
export function melodyItems(rand, [lo, hi] = ROOTS, n = MELODIES) {
  const same = Array.from({ length: n }, (_, i) => i < n / 2);
  for (let i = same.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [same[i], same[j]] = [same[j], same[i]];
  }
  return same.map((s) => {
    const root = pick(rand, lo, hi);
    const a = makeMelody(rand, root);
    return { a, b: s ? a.slice() : changeMelody(a, rand, root), same: s };
  });
}

// What the result says about the smallest step, by where it sits against
// the 25 cents the app counts as off for a sung note
export function stepRead(cents) {
  if (cents == null) return 'none';
  if (cents < SCALE_OFF) return 'finer';
  if (cents === SCALE_OFF) return 'same';
  return 'wider';
}

// Icons from the site's shared set (24 x 24)
const REDO = 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5';
const STOP = 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z';
const IMAGE = 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0M21 16l-5-5-8 8';
const SHARE = 'M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7';
const DOWNLOAD = 'M12 4v11M7 10l5 5 5-5M4 20h16';
const IPHONE = 'M8.5 2h7A2.5 2.5 0 0 1 18 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 19.5v-15A2.5 2.5 0 0 1 8.5 2zM11 18h2';
const TUNE = 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v4M12 18v4M2 12h4M18 12h4';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const CROSS = 'M6 6l12 12M18 6L6 18';

// One run, from the Start tap to its result. ui: what ear-test.js keeps for
// the mount; my: this run's token; piano: js/audio/piano.js
export function begin(ui, my, piano) {
  const { t, c, h, fmt, pd, test, icon } = ui;
  const [, runV, resV] = ui.panes;
  const pr = new Intl.PluralRules(ui.lang);
  const plural = (o, n) => (o && (o[pr.select(n)] || o.other)) || '';
  const cents = (n) => fmt(plural(t('units.cents'), n), { n });
  const gone = () => my !== ui.run;
  const rate = ui.rate || 1;
  const ms = (x) => x / rate;
  const seed = test && test.seed != null ? test.seed : (Math.random() * 2 ** 32) >>> 0;
  const rand = random(seed);
  let timer = 0;

  ui.stopAudio = () => {
    clearTimeout(timer);
    piano.release();
    keepAwake('ear', false);
  };
  keepAwake('ear', true);
  ui.onHide = () => piano.stopAll();
  piano.init(pd.piano && pd.piano.manifest, (pd.piano && pd.piano.base) || '/audio/piano-web/');
  piano.useContext(ui.ctx);

  function hook(kind, extra) {
    if (test && Array.isArray(test.events)) test.events.push({ kind, at: Date.now(), ...extra });
  }

  const wait = (x) => new Promise((r) => { timer = setTimeout(r, ms(x)); });

  // Every answer, step by step (true for right, in order) and melody by melody
  const marks = LEVELS.map(() => []);
  const tunes = [];

  // The steps as pairs of bars drawing closer; under each its answers as dots
  // (lit right, coral wrong), or in the result how many it got right of how
  // many it played, a dot for a step never reached
  function ladderEl(final) {
    return h('ol', { class: 'et-ladder' + (final ? ' et-ladder--result' : ''), 'aria-hidden': 'true' },
      ...LEVELS.map((s, i) => {
        const m = marks[i];
        const heard = m.filter(Boolean).length >= PASS;
        const li = h('li', { class: 'et-rung' + (heard ? ' et-rung--heard' : m.length ? ' et-rung--missed' : '') },
          h('span', { class: 'et-rung__step', text: ui.short(s) }));
        li.append(final
          ? h('span', { class: 'et-rung__score', text: m.length ? fmt(t('result.count'), { n: m.filter(Boolean).length, total: m.length }) : '·' })
          : h('span', { class: 'et-dots' }, ...m.map((ok) => h('i', { class: ok ? 'et-dot--ok' : 'et-dot--miss' }))));
        return li;
      }));
  }

  // The four melodies: a mark each, a check or a cross once answered, the
  // pair playing lit; in the result each says what the pair was
  function tunesEl(final, now) {
    return h('ol', { class: 'et-tunes', 'aria-hidden': 'true' }, ...Array.from({ length: MELODIES }, (_, i) => {
      const r = tunes[i];
      return h('li', { class: 'et-tune' + (r ? (r.ok ? ' et-tune--ok' : ' et-tune--miss') : i === now ? ' et-tune--now' : '') },
        r ? icon(r.ok ? CHECK : CROSS, 16) : h('span', { text: String(i + 1) }),
        final && r ? h('span', { class: 'et-tune__what', text: t(r.same ? 'run.same' : 'run.different') }) : null);
    }));
  }

  // The run's frame: status, the ladder of steps (the melodies' marks after),
  // the question, two answers, what the answer was, and Hear again and Stop
  const status = h('span', { text: c('loading') });
  const board = h('div', { class: 'et-board' }, ladderEl(false));
  const question = h('p', { class: 'st-question' });
  const said = h('p', { class: 'st-answer et-said', 'aria-live': 'off', text: BLANK });
  const yes = ui.button('', null, 'btn-secondary btn--lg btn--strong', { disabled: true });
  const no = ui.button('', null, 'btn-secondary btn--lg btn--strong', { disabled: true });
  const again = ui.button(t('run.again'), null, 'btn-secondary', { disabled: true }, icon(REDO));
  const stop = ui.button(c('stop'), () => ui.halt(), 'btn-secondary', null, icon(STOP, 18, true));
  runV.replaceChildren(h('div', { class: 'stage__head' }, h('p', { class: 'stage__status tool-panel__status' }, status)),
    h('div', { class: 'st-ear st-idle et-run' }, board, question, h('div', { class: 'tool-panel__actions' }, yes, no), said),
    h('div', { class: 'stage__actions' }, h('div', { class: 'tool-panel__actions' }, again, stop)));
  ui.show(runV, stop);

  function lockAnswers(on) {
    yes.disabled = no.disabled = again.disabled = on;
  }

  function focusAnswer() {
    const a = document.activeElement;
    if (!a || a === document.body || (ui.el.contains(a) && a !== again)) yes.focus({ preventScroll: true });
  }

  function paintLadder(st) {
    const l = ladderEl(false);
    if (!st.done) l.children[st.level].classList.add('et-rung--now');
    board.replaceChildren(l);
  }

  // Plays notes [{midi, cents, at (ms from now), ring}] and resolves once the
  // last has started, so the answers open as the last note sounds
  function play(notes) {
    if (gone() || !ui.ctx) return Promise.resolve();
    if (ui.ctx.state !== 'running') ui.ctx.resume().catch(() => {});
    piano.stopAll();
    const t0 = piano.getContext().currentTime + 0.05;
    for (const n of notes) piano.playNote(n.midi, { when: t0 + ms(n.at) / 1000, ringMs: n.ring, cents: n.cents || 0 });
    return wait(notes[notes.length - 1].at + ANSWER_MS);
  }

  const pairNotes = (p) => [{ midi: p.a, at: 0, ring: NOTE_MS }, { midi: p.b, cents: p.cents, at: GAP_MS, ring: SECOND_MS }];
  const tuneNotes = (it) => [...it.a.map((m, i) => ({ midi: m, at: i * TUNE_MS, ring: TUNE_MS + 120 })),
    ...it.b.map((m, i) => ({ midi: m, at: (it.a.length * TUNE_MS) + BETWEEN_MS + i * TUNE_MS, ring: i === it.b.length - 1 ? 900 : TUNE_MS + 120 }))];

  // One question: play, open the answers, wait for one, show what it was
  function ask(notes, labels, onAnswer) {
    return new Promise((resolve) => {
      yes.textContent = labels[0];
      no.textContent = labels[1];
      lockAnswers(true);
      said.textContent = BLANK;
      let open = false;
      const listen = () => play(notes).then(() => {
        if (gone()) return;
        open = true;
        lockAnswers(false);
        focusAnswer();
      });
      again.onclick = () => {
        if (!open) return;
        lockAnswers(true);
        listen();
      };
      const choose = (v) => () => {
        if (!open || gone()) return;
        open = false;
        lockAnswers(true);
        resolve(onAnswer(v));
      };
      yes.onclick = choose(true);
      no.onclick = choose(false);
      listen();
    });
  }

  async function steps() {
    let st = ladder();
    paintLadder(st);
    while (!st.done) {
      if (gone()) return null;
      const p = makePair(LEVELS[st.level], rand);
      status.textContent = fmt(t('run.stepOf'), { n: st.level + 1, total: LEVELS.length, step: stepText(p.step) });
      question.textContent = t('run.question');
      ui.say(status.textContent + '. ' + question.textContent);
      hook('ask', { step: p.step, up: p.up });
      // Lower on the left, as on a keyboard and in the app
      const ok = await ask(pairNotes(p), [t('run.lower'), t('run.higher')], (lower) => lower !== p.up);
      if (gone()) return null;
      hook('pair', { step: p.step, up: p.up, ok });
      marks[st.level].push(ok);
      said.replaceChildren(ok ? icon(CHECK, 16) : '', t(p.up ? 'run.wentUp' : 'run.wentDown'));
      said.classList.toggle('et-said--ok', ok);
      ui.say(said.textContent);
      st = answer(st, ok);
      paintLadder(st);
      await wait(FEEDBACK_MS);
    }
    return st;
  }

  async function melodies() {
    const items = melodyItems(rand);
    let right = 0;
    for (let i = 0; i < items.length; i++) {
      if (gone()) return null;
      const it = items[i];
      board.replaceChildren(tunesEl(false, i));
      status.textContent = fmt(t('run.melodyOf'), { n: i + 1, total: items.length });
      question.textContent = t('run.sameQuestion');
      ui.say(status.textContent + '. ' + question.textContent);
      hook('ask', { same: it.same });
      const ok = await ask(tuneNotes(it), [t('run.same'), t('run.different')], (same) => same === it.same);
      if (gone()) return null;
      hook('melody', { same: it.same, ok });
      tunes.push({ same: it.same, ok });
      board.replaceChildren(tunesEl(false, -1));
      if (ok) right++;
      said.replaceChildren(ok ? icon(CHECK, 16) : '', t(it.same ? 'run.wereSame' : 'run.wereDifferent'));
      said.classList.toggle('et-said--ok', ok);
      ui.say(said.textContent);
      await wait(FEEDBACK_MS);
    }
    return { right, total: items.length };
  }

  function stepText(step) {
    return step >= 100 ? fmt(plural(t('units.semitones'), 1), { n: 1 }) : cents(step);
  }

  async function run() {
    const notes = [];
    for (let m = Math.min(BAND[0], ROOTS[0]) - 1; m <= Math.max(BAND[1], ROOTS[1] + 12) + 1; m++) notes.push(m);
    const bufs = await Promise.all([...new Set(notes.map((m) => piano.sampleFor(m) && piano.sampleFor(m).sample))]
      .filter(Boolean).map((m) => piano.ensureNote(m)));
    if (gone()) return;
    if (!bufs.length || bufs.some((b) => !b)) return ui.fail('pianoFailed');
    const st = await steps();
    if (!st || gone()) return;
    status.textContent = t('run.melodiesNext');
    question.textContent = BLANK;
    said.textContent = BLANK;
    await wait(FEEDBACK_MS);
    const mel = await melodies();
    if (!mel || gone()) return;
    result({ smallest: smallest(st), heard: st.heard + 1, levels: LEVELS.length, melodies: mel.right, total: mel.total });
  }

  // The app's offer, where the page has no band of its own (append() and
  // replaceChildren() print a null as text, so none is '')
  function cta() {
    if (document.getElementById('app')) return '';
    const android = /Android/i.test((globalThis.navigator && navigator.userAgent) || '');
    return h('div', { class: 'result__cta' }, h('p', { text: t('result.ctaBody') }),
      android && pd.playLink
        ? h('p', { class: 'result__buttons' },
          h('a', { class: 'btn btn-primary', href: pd.playLink, rel: 'noopener' }, icon(DOWNLOAD), t('result.ctaButton')),
          pd.iphone && h('button', { type: 'button', class: 'btn btn--iphone', disabled: true, 'aria-disabled': 'true' },
            icon(IPHONE), h('span', { text: pd.iphone })))
        : h('p', { text: pd.androidOnlyLine || '' }));
  }

  // The next challenge: the sing-in-tune test, where the page has it
  function challenge() {
    const href = pd.links && pd.links['sing-in-tune-test'];
    if (!href) return null;
    return h('div', { class: 'et-next card' },
      h('p', { class: 'kicker', text: t('next.kicker') }),
      h('p', { class: 'et-next__title', text: t('next.title') }),
      h('p', { class: 'et-next__body', text: t('next.body') }),
      h('a', { class: 'btn btn--fill', href }, icon(TUNE), t('next.button')));
  }

  function shareRow(r) {
    const d = new Date();
    const url = (document.querySelector('link[rel=canonical]') || location).href;
    const value = r.smallest == null ? '' : String(r.smallest);
    const data = {
      lang: ui.lang,
      date: [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((x) => String(x).padStart(2, '0')).join('-'),
      smallest: r.smallest, levels: LEVELS, heard: r.heard,
      text: {
        title: t('share.title'), value, unit: t('share.cents'), line: t('share.line'),
        line2: fmt(t('share.melodies'), { n: r.melodies, total: r.total }),
        steps: LEVELS.map((s) => ui.short(s)), pairs: t('share.pairs'), ask: t('share.ask'), site: new URL(url).host,
      },
    };
    const cv = h('canvas', { width: 1080, height: 1920, role: 'img', hidden: true,
      'aria-label': [t('share.title'), cents(r.smallest), data.text.line2].join('. ') });
    const save = ui.button(c('save'), null, 'btn-secondary', { disabled: true }, icon(IMAGE));
    const send = globalThis.navigator && navigator.share ? ui.button(c('share'), null, 'btn-secondary', { disabled: true }, icon(SHARE)) : null;
    const row = h('div', { class: 'share share-card' }, cv, h('div', { class: 'share-card__actions' }, save, send));
    ui.share().then(async (s) => {
      await s.drawEarCard(cv, data);
      const file = await s.toFile(cv, t('share.fileName') + '.png');
      if (!file) return row.remove();
      cv.hidden = save.disabled = false;
      save.onclick = () => s.save(file);
      if (send) {
        send.disabled = false;
        send.onclick = () => s.share(file, { title: t('share.title'), text: fmt(t('share.text'), { cents: cents(r.smallest) }) + ' ' + url, url });
      }
    }).catch(() => row.remove());
    return row;
  }

  function result(r) {
    ui.halt(false);
    const last = ui.load(ui.keys.last);
    const read = stepRead(r.smallest);
    const count = (n, total) => fmt(t('result.count'), { n, total });
    const card = h('div', { class: 'result result-card et-card' }, h('p', { class: 'result-card__label', text: t('result.label') }));
    if (r.smallest == null) {
      card.append(h('p', { class: 'result-card__note st-say', text: t('result.none') }));
    } else {
      card.append(h('p', { class: 'result-card__value' }, ui.short(r.smallest)),
        h('p', { class: 'result-card__note st-say', text: fmt(t('result.' + read), { cents: cents(r.smallest) }) }));
    }
    // Step by step and melody by melody: what was heard of each, drawn, and
    // in words for a screen reader
    const said = LEVELS.map((s, i) => ui.short(s) + ': ' + (marks[i].length ? count(marks[i].filter(Boolean).length, marks[i].length) : '·'));
    card.append(
      h('p', { class: 'kicker kicker--soft et-kicker' }, t('result.steps'), h('b', { text: count(r.heard, r.levels) })),
      ladderEl(true), h('p', { class: 'sr-only', text: said.join(', ') }),
      h('p', { class: 'kicker kicker--soft et-kicker' }, t('result.melodies'), h('b', { text: count(r.melodies, r.total) })),
      tunesEl(true, -1),
      h('p', { class: 'result-card__note', text: t('result.cent') + ' ' + t('result.sample') }));
    const before = ui.lastLine(last);
    if (before) card.append(h('p', { class: 'result-card__note', text: before }));
    ui.store(ui.keys.last, { smallest: r.smallest, melodies: r.melodies, total: r.total, at: new Date().toISOString() });
    const redo = ui.button(t('result.again'), ui.start, 'btn-secondary', null, icon(REDO));
    const side = [challenge(), r.smallest == null ? null : shareRow(r), cta(),
      h('div', { class: 'tool-panel__actions et-again' }, redo)].filter(Boolean);
    resV.replaceChildren(h('div', { class: 'st-result' }, card, h('div', { class: 'st-side' }, ...side)));
    ui.say(t('result.label') + '. ' + (r.smallest == null ? t('result.none') : cents(r.smallest)));
    ui.show(resV, redo);
    hook('result', r);
  }


  return run();
}
