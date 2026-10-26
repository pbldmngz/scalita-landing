/*
 * The share images under test. Builds a case's data from a locale's page
 * data the way the tools do (every string from the ui files, every note name
 * from the app's export), draws it with the real modules and records each
 * text, fill and stroke the drawing made, then judges the record: nothing
 * outside the frame, no text on another, on a key, on a voice's line or on
 * a landing, nothing squeezed, no placeholder left. With ?nofilter the page
 * has no ctx.filter, as in Safari, so the modules take their shadow blur.
 */
const NOFILTER = new URLSearchParams(location.search).has('nofilter');
if (NOFILTER) delete CanvasRenderingContext2D.prototype.filter;

// The record: the geometry of each path, then every call that paints
const rec = { texts: [], fills: [], strokes: [] };
const geo = (o) => o.__geo || (o.__geo = { subs: [], box: [Infinity, Infinity, -Infinity, -Infinity] });
function put(o, pts, start) {
  const g = geo(o);
  if (start || !g.subs.length) g.subs.push([]);
  for (const [x, y] of pts) {
    g.subs[g.subs.length - 1].push([x, y]);
    g.box = [Math.min(g.box[0], x), Math.min(g.box[1], y), Math.max(g.box[2], x), Math.max(g.box[3], y)];
  }
}
const PATH = {
  moveTo: (o, [x, y]) => put(o, [[x, y]], true),
  lineTo: (o, [x, y]) => put(o, [[x, y]]),
  quadraticCurveTo: (o, [a, b, x, y]) => put(o, [[a, b], [x, y]]),
  arc: (o, [x, y, r]) => put(o, [[x - r, y - r], [x + r, y + r]], true),
  rect: (o, [x, y, w, h]) => put(o, [[x, y], [x + w, y + h]], true),
  roundRect: (o, [x, y, w, h]) => put(o, [[x, y], [x + w, y + h]], true),
};
for (const [proto, ctx] of [[Path2D.prototype, false], [CanvasRenderingContext2D.prototype, true]]) {
  for (const [name, f] of Object.entries(PATH)) {
    const orig = proto[name];
    if (!orig) continue;
    proto[name] = function (...a) {
      f(ctx ? this.__path || (this.__path = {}) : this, a);
      return orig.apply(this, a);
    };
  }
}
const C2D = CanvasRenderingContext2D.prototype;
const wrap = (name, f) => {
  const orig = C2D[name];
  C2D[name] = function (...a) {
    f(this, a);
    return orig.apply(this, a);
  };
};
const moved = (g, [x0, y0, x1, y1]) => {
  const m = g.getTransform();
  return [m.a * x0 + m.e, m.d * y0 + m.f, m.a * x1 + m.e, m.d * y1 + m.f];
};
const state = (g) => ({ style: String(g.fillStyle), alpha: g.globalAlpha, shadow: g.shadowOffsetX !== 0 });
wrap('beginPath', (g) => { g.__path = {}; });
wrap('fill', (g, [p]) => {
  const o = p instanceof Path2D ? p : g.__path || {};
  rec.fills.push({ ...state(g), box: moved(g, geo(o).box) });
});
wrap('stroke', (g, [p]) => {
  const o = p instanceof Path2D ? p : g.__path || {};
  const m = g.getTransform();
  rec.strokes.push({ style: String(g.strokeStyle), width: g.lineWidth, shadow: g.shadowOffsetX !== 0,
    subs: geo(o).subs.map((s) => s.map(([x, y]) => [m.a * x + m.e, m.d * y + m.f])) });
});
wrap('fillRect', (g, [x, y, w, h]) => rec.fills.push({ ...state(g), box: moved(g, [x, y, x + w, y + h]) }));
wrap('fillText', (g, [s, x, y, max]) => {
  const m = g.measureText(s), k = max !== undefined && m.width > max ? max / m.width : 1;
  rec.texts.push({ s: String(s), x, y, k, font: g.font, align: g.textAlign, style: String(g.fillStyle), shadow: g.shadowOffsetX !== 0,
    box: [x - m.actualBoundingBoxLeft * k, y - m.actualBoundingBoxAscent, x + m.actualBoundingBoxRight * k, y + m.actualBoundingBoxDescent] });
});

// The tools' own rules, as the spec gives them
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const get = (o, k) => k.split('.').reduce((a, b) => (a || {})[b], o);
const longer = (s) => String(s).replace(/\{\w+\}|\p{L}+/gu, (m) => (m[0] === '{' ? m : m + m.slice(0, Math.ceil(m.length * 0.4))));

function typicalFor(types, low, high) {
  const mid = (low + high) / 2;
  const by = (types || []).map((t, i) => [Math.abs((t.rangeLow + t.rangeHigh) / 2 - mid), i, t])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!by.length) return [];
  return by.length > 1 && by[1][0] - by[0][0] <= 2 ? [by[0][2], by[1][2]] : [by[0][2]];
}

function tools(pd, stretch) {
  const lang = pd.lang, notes = pd.notes;
  const one = (x, o) => {
    try {
      return new Intl.PluralRules(lang, o).select(x) === 'one';
    } catch {
      return x === 1;
    }
  };
  return {
    lang, one,
    T: (strings) => (k, v = {}) => fill(stretch(get(strings, k)), v),
    local: (m) => notes[m][0],
    intl: (m) => notes[m][1],
    num: (x, o) => new Intl.NumberFormat(lang, o).format(x),
  };
}

const ONE = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

function rangeData(c, pd, stretch, cases) {
  const k = tools(pd, stretch), T = k.T(pd.strings['vocal-range-test']), C = k.T(pd.strings.common);
  const { low, high } = c, span = high - low, oct = span / 12;
  const types = span >= 12 && span < 36 ? typicalFor(pd.voiceTypes, low, high).map((t) => stretch(t.name)) : [];
  // the bracket over the whole range (Pablo's final range image, 2026-10-26):
  // the voice type(s) from an octave up, the voice types held whole from three
  let bracket = null;
  if (types.length) {
    bracket = { big: types.length === 2 ? T('typeOr', { first: types[0], second: types[1] }) : types[0], small: T('typical') };
  } else if (span >= 36) {
    const whole = (pd.voiceTypes || []).filter((t) => low <= t.rangeLow && high >= t.rangeHigh)
      .sort((a, b) => a.rangeLow - b.rangeLow).map((t) => stretch(t.name));
    const n = whole.length;
    bracket = !n ? { big: T('beyondOneType'), small: T('rangeValue', { low: k.local(low), high: k.local(high) }) }
      : n === 1 ? { big: T('typesOne', { n }), small: T('oneTypeWhole', { type: whole[0] }) }
        : { big: n === pd.voiceTypes.length ? T('allTypes') : T(k.one(n) ? 'typesOne' : 'typesMany', { n }),
          small: T('typesSpan', { low: whole[0], high: whole[n - 1] }) };
  }
  const labels = {};
  for (let m = low; m <= high; m++) if (m % 12 === 0) labels[m] = k.local(m);
  const contour = c.trails && cases.contours[c.trails];
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  return {
    lang: k.lang, low, high, date: cases.date,
    names: { low: { local: k.local(low), intl: k.intl(low) }, high: { local: k.local(high), intl: k.intl(high) }, a4: k.local(69) },
    labels, hz: { low: hz(low), high: hz(high) }, semitones: span, octaves: oct,
    bracket,
    trails: { low: contour && c.only !== 'high' ? contour.low : null, high: contour && c.only !== 'low' ? contour.high : null },
    text: {
      kicker: T('shareKicker'), ref: C('refPitch', { note: k.local(69) }),
      semitones: T(k.one(span) ? 'semitoneOne' : 'semitoneMany', { n: span }),
      octaves: T(k.one(oct, ONE) ? 'octaveOne' : 'octaveMany', { n: k.num(oct, ONE) }),
      caption: T('shareTwoLines'), ask: T('shareAsk'), site: 'scalita.com', hz: C('hz'),
    },
  };
}

function tuneData(c, pd, stretch, cases) {
  const k = tools(pd, stretch), T = k.T(pd.strings['sing-in-tune-test']);
  const heard = c.notes.filter((n) => n.cents !== null), judged = heard.length;
  const inTune = heard.filter((n) => Math.abs(n.cents) <= 10).length, close = heard.filter((n) => Math.abs(n.cents) <= 25).length;
  const cents = (n) => T(k.one(n) ? 'units.cents.one' : 'units.cents.other', { n });
  const line2 = (inTune >= Math.ceil(judged / 2) ? T('share.within10', { n: inTune, total: judged }) : T('share.within25', { n: close, total: judged }))
    + (c.wobble !== null ? ' \u00b7 ' + T('share.wobble', { cents: cents(c.wobble) }) : '');
  return {
    lang: k.lang, date: cases.date, off: c.off, judged, total: c.notes.length, inTune, close, wobble: c.wobble,
    notes: c.notes.map((n) => ({ name: k.local(n.midi), cents: n.cents, path: n.path })),
    text: {
      title: T('share.title'), cents: T('share.cents'), typical: T('share.typical', { n: judged }), line2,
      bandClose: T('share.bandClose'), bandIn: T('share.bandIn'), theNote: T('share.theNote'),
      lines: T('share.lines'), ask: T('share.ask'), site: 'scalita.com',
    },
  };
}

// The judgement
const KEYS = new Set(['#262f32', '#1a2123', '#7fb3b5', '#4f8f93']);
const meets = (a, b, pad = 0) => a[0] < b[2] - pad && b[0] < a[2] - pad && a[1] < b[3] - pad && b[1] < a[3] - pad;
const within = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const grow = (b, d) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];

function judge(kind, r) {
  const bad = [];
  const texts = r.texts.filter((t) => t.s.trim() && !t.shadow);
  for (const t of texts) {
    if (/undefined|NaN|null|\{\w+\}/.test(t.s)) bad.push('a placeholder or a missing value: ' + t.s);
    if (t.k < 0.999) bad.push('squeezed to ' + (100 * t.k).toFixed(1) + '%: ' + t.s);
    const band = kind === 'tune' && t.x === 1064;
    const [x0, y0, x1, y1] = t.box;
    if (x0 < 80 || x1 > (band ? 1066 : 1000) || y0 < 56 || y1 > 1864) bad.push('outside the frame: ' + t.s + ' ' + t.box.map(Math.round));
    if (band && x0 < 905) bad.push('a band label reaches the fifth note: ' + t.s);
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (meets(texts[i].box, texts[j].box, 0.5)) bad.push('"' + texts[i].s + '" touches "' + texts[j].s + '"');
    }
  }
  if (kind === 'range') {
    const keys = r.fills.filter((f) => !f.shadow && KEYS.has(f.style)).map((f) => f.box);
    const kb = [Math.min(...keys.map((b) => b[0])), Math.min(...keys.map((b) => b[1])), Math.max(...keys.map((b) => b[2])), Math.max(...keys.map((b) => b[3]))];
    for (const t of texts) {
      if (t.x === 214 && t.align === 'right') {
        if (t.box[0] < 179 || t.box[2] > 226 || t.box[1] < kb[1] || t.box[3] > kb[3]) bad.push('a key label off its key: ' + t.s);
      } else if (meets(t.box, kb)) bad.push('text on the keys: ' + t.s);
    }
  } else {
    // each note's name and cents stay in its slot, 150 wide
    for (const t of texts) if (t.align === 'center' && Math.abs(t.x - 176 - Math.round((t.x - 176) / 160.8) * 160.8) < 1) {
      if (t.box[0] < t.x - 75 || t.box[2] > t.x + 75) bad.push('a note label wider than its slot: ' + t.s);
    }
  }
  const lines = r.strokes.filter((s) => !s.shadow && s.width === 3.5);
  const dots = r.fills.filter((f) => !f.shadow && f.style === '#e8edee' && f.box[2] - f.box[0] <= 15);
  for (const t of texts) {
    const b = grow(t.box, 3.75);
    if (lines.some((l) => l.subs.some((s) => s.some((p, i) => within(p, b) || (i && within([(p[0] + s[i - 1][0]) / 2, (p[1] + s[i - 1][1]) / 2], b)))))) {
      bad.push('text on a voice line: ' + t.s);
    }
    if (dots.some((d) => meets(t.box, d.box))) bad.push('text on a landing: ' + t.s);
  }
  return [...new Set(bad)];
}

let card, tune;
const ready = (async () => {
  card = await import('/js/tools/share-card.js');
  tune = await import('/js/tools/share-tune.js');
})();

window.share = {
  ready,
  nofilter: NOFILTER,
  // kind 'range' or 'tune'; opts: {stretch: 40% longer words, png: return the image}
  async run(kind, c, pd, cases, opts = {}) {
    await ready;
    const data = (kind === 'range' ? rangeData : tuneData)(c, pd, opts.stretch ? longer : (s) => s, cases);
    const canvas = document.createElement('canvas');
    rec.texts = [];
    rec.fills = [];
    rec.strokes = [];
    const t0 = performance.now();
    const out = await (kind === 'range' ? card.drawRangeCard(canvas, data) : tune.drawTuneCard(canvas, data));
    const ms = Math.round(performance.now() - t0);
    const thin = [...document.fonts].some((f) => f.weight === '200' && f.status === 'loaded');
    return { bad: judge(kind, rec), texts: rec.texts.map((t) => t.s), size: [canvas.width, canvas.height], same: out === canvas,
      thin, ms, png: opts.png ? canvas.toDataURL('image/png') : null };
  },
  // Pixel difference against a reference PNG: mean and largest channel
  // difference, and the share of pixels off by more than 24
  async compare(png, ref) {
    const load = (src) => new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = no;
      i.src = src;
    });
    let b;
    try {
      b = await load(ref);
    } catch {
      return { missing: true };
    }
    const a = await load(png);
    if (a.width !== b.width || a.height !== b.height) return { size: [a.width, a.height, b.width, b.height] };
    const px = (img) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const p = px(a), q = px(b);
    let sum = 0, over = 0, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
      sum += d;
      if (d > 24) over++;
      if (d > max) max = d;
    }
    return { mean: sum / (p.length / 4), over: over / (p.length / 4), max };
  },
};
