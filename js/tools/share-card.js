/*
 * The share images, drawn on the reader's device at Stories size (1080 x
 * 1920) in Sora: nothing is uploaded and no third-party script runs. Load
 * it after a result.
 *
 *   await drawRangeCard(canvas, data)   the vocal range image
 *   toFile(canvas, name)                the PNG as a File
 *   canShare(file)                      true where share() can do something
 *   share(file, {title, text, url})     call it inside the tap: 'shared',
 *                                       'cancelled', 'failed' or 'unsupported'
 *   save(file)                          a download of the image
 *
 * Data, positions and colours: section 4 of the site redesign spec, and
 * tool/tests/share/README.md. No words live here: every string comes in.
 * share-tune.js draws the sing-in-tune image with `kit`.
 */

export const WIDTH = 1080;
export const HEIGHT = 1920;
const SANS = "Sora, -apple-system, 'Segoe UI', sans-serif";
const CREAM = '#E8EDEE', SOFT = '#A8B5BA', SLATE = '#7A8B91', MIST = '#3A4548', SEAFOAM = '#7FB3B5', GLOW = '#8AC4C7';

// Sora 200, for the big notes and figures, only this module loads; drawing
// waits a second and a half at most for the fonts, at 300 without the 200
let thin;
async function setup(canvas) {
  const f = globalThis.document && document.fonts;
  if (f && f.load) {
    try {
      if (!thin) f.add(thin = new FontFace('Sora', 'url(/fonts/sora-200.woff2)', { weight: '200' }));
    } catch {}
    await Promise.race([new Promise((r) => setTimeout(r, 1500)),
      Promise.all(['200 236px', '300 236px', '400 24px', '500 34px'].map((s) => f.load(s + ' Sora').catch(() => {})))]);
  }
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  return [canvas.getContext('2d'), thin && thin.status === 'loaded' ? 200 : 300];
}

const safe = (f, alt) => {
  try {
    return f();
  } catch {
    return alt;
  }
};
const num = (lang, v, o) => safe(() => new Intl.NumberFormat(lang, o).format(v), String(v));
// day first, as the site writes English dates
const day = (lang, iso) => safe(() => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang,
  { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(...String(iso).split('-').map((x, i) => x - (i === 1)))), '');
const upper = (lang, s) => safe(() => String(s || '').toLocaleUpperCase(lang), String(s || '').toUpperCase());

function face(g, weight, size, track) {
  g.font = weight + ' ' + size + 'px ' + SANS;
  if ('letterSpacing' in g) g.letterSpacing = (track || 0) * size + 'px';
}

// One line in a CSS line box (top, lh) as the mockups place text: Sora rises
// .97 of its size and falls .29, so the baseline is at top + lh / 2 + .34
// size. It comes down a pixel at a time to o.min to fit o.max, and only
// then is squeezed. Returns its width.
function line(g, s, x, top, o) {
  if (!s) return 0;
  const max = o.max || 1e4;
  let size = o.size, w;
  for (;;) {
    face(g, o.weight || 400, size, o.track);
    w = g.measureText(s).width;
    if (w <= max || size <= (o.min || size)) break;
    size--;
  }
  g.textAlign = o.align || 'left';
  g.fillStyle = o.color;
  g.fillText(s, x, top + (o.lh || size * 1.26) / 2 + 0.34 * size, max);
  return Math.min(w, max);
}

// Words in runs of colour, [[text, colour]], wrapped to o.max in at most
// o.lines lines, coming down to o.min until they fit; o.lh is a factor. A
// name in brackets, "Do3 (C3)", stays with the word before it.
function fit(g, runs, o) {
  const words = [];
  for (const [s, c] of runs) {
    for (const w of String(s || '').split(/\s+/)) {
      const p = words[words.length - 1];
      if (w[0] === '(' && p && p[1] === c) p[0] += ' ' + w;
      else if (w) words.push([w, c]);
    }
  }
  let size = o.size, rows;
  for (;;) {
    face(g, o.weight || 400, size);
    const sp = g.measureText(' ').width;
    rows = [];
    for (const [t, c] of words) {
      const w = g.measureText(t).width, r = rows[rows.length - 1];
      if (r && r.w + sp + w <= o.max) {
        r.words.push([t, c, r.w + sp, w]);
        r.w += sp + w;
      } else rows.push({ words: [[t, c, 0, w]], w });
    }
    rows.ok = rows.length <= o.lines && rows.every((r) => r.w <= o.max);
    if (rows.ok || size <= (o.min || o.size)) {
      // past the smallest size the last line takes the rest, squeezed: no word is dropped
      while (rows.length > o.lines) {
        const r = rows.pop(), last = rows[rows.length - 1];
        for (const [t, c, at, w] of r.words) last.words.push([t, c, last.w + sp + at, w]);
        last.w += sp + r.w;
      }
      return { size, rows, o };
    }
    size--;
  }
}

function paint(g, { size, rows, o }, x, top) {
  const lh = size * o.lh;
  face(g, o.weight || 400, size);
  g.textAlign = 'left';
  rows.slice(0, o.lines).forEach((r, i) => {
    const k = Math.min(1, o.max / r.w), x0 = x - r.w * k * ({ right: 1, center: 0.5 }[o.align] || 0);
    for (const [t, c, at, w] of r.words) {
      g.fillStyle = c;
      g.fillText(t, x0 + at * k, top + i * lh + lh / 2 + 0.34 * size, k < 1 ? w * k : 1e4);
    }
  });
  return top + Math.min(rows.length, o.lines) * lh;
}

const para = (g, runs, x, top, o) => paint(g, fit(g, runs, o), x, top);

// One line, coming down to o.one; else o.lines lines from o.wrap down
const best = (g, runs, o) => {
  const a = fit(g, runs, { ...o, lines: 1, min: o.one });
  return a.rows.ok ? a : fit(g, runs, { ...o, size: o.wrap || o.size });
};

// A Gaussian of sigma, as the mockups' feGaussianBlur: the shadow of a copy
// drawn off the canvas, so every browser blurs alike, Safari included
function soft(g, sigma, rgba, draw) {
  g.save();
  g.shadowColor = 'rgba(' + rgba + ')';
  g.shadowBlur = 2 * sigma;
  g.shadowOffsetX = 4000;
  g.translate(-4000, 0);
  g.fillStyle = g.strokeStyle = '#000';
  draw();
  g.restore();
}

// CSS radial-gradient(ellipse rx ry at x y) of ocean, stops [offset, alpha]
function light(g, x, y, rx, ry, stops) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  for (const [o, a] of stops) r.addColorStop(o, 'rgba(90,159,163,' + a + ')');
  g.fillStyle = r;
  g.fillRect(-x, -y * rx / ry, WIDTH, HEIGHT * rx / ry);
  g.restore();
}

function stroke(g, p, colour, width, cap = 'round') {
  if (typeof p === 'string') p = new Path2D(p);
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = cap;
  g.lineJoin = cap === 'round' ? cap : 'miter';
  g.stroke(p);
}

// The singer's voice: its glow, its line, then where it landed
function trail(g, pts, r) {
  const p = new Path2D(), dot = new Path2D(), [x, y] = pts[pts.length - 1];
  pts.forEach(([a, b], i) => p[i ? 'lineTo' : 'moveTo'](a, b));
  if (pts.length > 1) {
    soft(g, 7, '90,159,163,.75', () => stroke(g, p, '#000', 12));
    stroke(g, p, GLOW, 3.5);
  }
  dot.arc(x, y, 2 * r, 0, 7);
  soft(g, 6, '138,196,199,.35', () => g.fill(dot));
  g.fillStyle = CREAM;
  g.beginPath();
  g.arc(x, y, r, 0, 7);
  g.fill();
}

// Cents over time, finite values only, at n evenly spaced points
function resample(a, n) {
  const v = (Array.isArray(a) ? a : []).filter(Number.isFinite);
  return v.length < 2 ? null : Array.from({ length: n }, (_, i) => {
    const t = i * (v.length - 1) / (n - 1), k = Math.min(t | 0, v.length - 2);
    return v[k] + (v[k + 1] - v[k]) * (t - k);
  });
}

const clamp = (v, a) => Math.max(-a, Math.min(a, v));

function logo(g, x, y, s) {
  const k = s / 1024;
  [214, 480, 378, 288, 542, 384, 706, 192].forEach((a, i, l) => {
    if (i % 2) return;
    g.fillStyle = i % 4 ? '#6FAAA9' : '#549296';
    g.beginPath();
    (g.roundRect ? g.roundRect : g.rect).call(g, x + a * k, y + l[i + 1] * k, 104 * k, 352 * k, 32 * k);
    g.fill();
  });
}

// The quiet invitation, a row 44 tall: the logo and its name (the brand,
// not copy) at left, the question and the address at right
function invite(g, top, ask, site) {
  logo(g, 96, top + 2, 40);
  const name = line(g, 'Scalita', 148, top, { size: 26, weight: 500, lh: 44, color: CREAM });
  const w = line(g, site, 984, top, { size: 26, weight: 500, lh: 44, color: SEAFOAM, align: 'right', max: 300, min: 18 });
  line(g, ask, 970 - w, top, { size: 26, lh: 44, color: SOFT, align: 'right', max: 790 - w - name, min: 16 });
}

export const kit = { setup, face, num, day, line, fit, best, paint, para, soft, light, trail, resample, clamp, invite };

/*
 * The vocal range image (mockups SH3-range-b-strong, SH3-range-b-modest,
 * SH4-range-b-wide): the two notes as an instrument's readout, a flat piano
 * roll that adapts to the range, the whole range lit in one bloom, and the
 * singer's own held notes landing on their keys.
 */
export async function drawRangeCard(canvas, d) {
  const [g, w200] = await setup(canvas);
  const t = d.text || {}, lang = d.lang || 'en', names = d.names || {}, lo = d.low, hi = d.high, span = hi - lo;
  const bg = g.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, '#1E2628');
  bg.addColorStop(1, '#1B2325');
  g.fillStyle = bg;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  light(g, 540, 461, 760, 640, [[0, 0.14], [0.7, 0]]);
  light(g, 626, 1190, 640, span < 36 ? 620 : 720, [[0, 0.16], [0.7, 0]]);
  stroke(g, 'M56 88V56h32M992 56h32v32M56 1832v32h32M1024 1832v32h-32', MIST, 1.5, 'butt');

  // The readout: the reference pitch in capitals, its note as written
  // (case is meaningful in German), a ruler, what and when
  logo(g, 96, 100, 44);
  const brand = line(g, 'Scalita', 154, 100, { size: 34, weight: 500, lh: 44, color: CREAM, track: 0.01 });
  const a4 = names.a4 || '';
  line(g, String(t.ref || '').split(a4).map((s) => upper(lang, s)).join(a4), 984, 108,
    { size: 20, weight: 500, lh: 28, color: SLATE, track: 0.18, align: 'right', max: 790 - brand, min: 14 });
  let major = 'M96 184.5H984', minor = '';
  for (let x = 96; x <= 984; x += 148) {
    major += 'M' + x + ' 172v12';
    if (x < 984) for (const s of [37, 74, 111]) minor += 'M' + (x + s) + ' 178v6';
  }
  stroke(g, minor + major.slice(0, 13), MIST, 1, 'butt');
  stroke(g, major.slice(13), 'rgba(122,139,145,.6)', 1.5, 'butt');
  const date = line(g, upper(lang, day(lang, d.date)), 984, 236, { size: 22, lh: 28, color: SLATE, track: 0.12, align: 'right', max: 420, min: 16 });
  line(g, upper(lang, t.kicker), 96, 236, { size: 22, weight: 500, lh: 28, color: SLATE, track: 0.2, max: 856 - date, min: 16 });

  // The two notes as large as they fit with the count between them (its
  // width or its bracket's, 15 clear each side); else the count goes under
  const ln = names.low || {}, hn = names.high || {}, middle = span >= 12;
  face(g, 400, 24, 0.04);
  const gap = Math.max(204, Math.min(300, g.measureText(t.semitones || '').width)) + 30;
  let size = 236, wl, wh, drop, between = middle;
  const fits = () => {
    face(g, w200, size, -0.02);
    const a = g.measureText(ln.local || ''), b = g.measureText(hn.local || '');
    [wl, wh, drop] = [a.width, b.width, Math.max(a.actualBoundingBoxDescent, b.actualBoundingBoxDescent) || 0];
    return wl + wh + (between ? gap : 48) <= 896;
  };
  while (!fits() && size > 150) size = Math.max(150, size - 8);
  if (!fits()) between = false;
  while (!fits() && size > 96) size = Math.max(96, size - 8);
  line(g, ln.local, 92, 292, { size, weight: w200, lh: 236, color: CREAM, track: -0.02 });
  line(g, hn.local, 988, 292, { size, weight: w200, lh: 236, color: CREAM, track: -0.02, align: 'right' });
  // the international names, clear of a descender (German g)
  const base = 410 + 0.34 * size, under = base + Math.max(40, drop + 6);
  const intl = (n, x, align) => (n.intl && n.intl !== n.local ? line(g, n.intl, x, under, { size: 26, color: SLATE, align, max: 240 }) : 0);
  const wi = Math.max(intl(ln, 92, 'left'), intl(hn, 988, 'right'));
  if (between) {
    const cx = Math.min(Math.max(540, 92 + wl + gap / 2), 988 - wh - gap / 2);
    line(g, t.semitones, cx, 362, { size: 24, lh: 30, color: SEAFOAM, track: 0.04, align: 'center', max: 300, min: 16 });
    stroke(g, 'M' + (cx - 102) + ' 422h204M' + (cx - 102) + ' 410v24M' + (cx + 102) + ' 410v24', '#5A9FA3', 2, 'butt');
  } else if (middle) {
    line(g, t.semitones, 540, under, { size: 24, lh: 34.1, color: SEAFOAM, track: 0.04, align: 'center', max: Math.min(300, 848 - 2 * wi), min: 16 });
  }
  g.shadowColor = 'rgba(138,196,199,.35)';
  g.shadowBlur = 40;
  line(g, middle ? t.octaves : t.semitones, 92, 560, { size: 112, weight: w200, lh: 130, color: GLOW, track: -0.01, max: 896, min: 64 });
  g.shadowColor = 'transparent';

  // The roll: the range and a few keys past each end, a row a key, centred
  // on y 1205. Nothing is drawn above it (no type line: Pablo's final range
  // image, 2026-10-26), and its top never rises over 732
  const m = Math.min(5, Math.max(1, (60 - span) >> 1)), k0 = lo - m, rows = span + 1 + 2 * m;
  let h = Math.max(14, Math.min(34, 827 / rows));
  const bottom = 1205 + rows * h / 2;
  h = Math.min(h, (bottom - 732) / rows);
  const mid = (k) => bottom - (k - k0 + 0.5) * h;
  const black = (k) => [1, 3, 6, 8, 10].includes(k % 12);
  const inside = (k) => k >= k0 && k < k0 + rows;
  const heads = {};
  // a key is a bar, square at left, its right end rounded
  const bar = (p, x0, y0, x1, y1, r) => {
    p.moveTo(x0, y0);
    p.lineTo(x1 - r, y0);
    p.quadraticCurveTo(x1, y0, x1, y0 + r);
    p.lineTo(x1, y1 - r);
    p.quadraticCurveTo(x1, y1, x1 - r, y1);
    p.lineTo(x0, y1);
    p.closePath();
  };
  const keys = (lit, isBlack) => {
    const p = new Path2D();
    for (let k = k0; k < k0 + rows; k++) {
      if ((k >= lo && k <= hi) !== lit || (isBlack !== undefined && black(k) !== isBlack)) continue;
      const y0 = mid(k) - h / 2 + 1.5, y1 = y0 + h - 3;
      if (black(k)) bar(p, 96, y0, 176, y1, Math.min(4, h / 5));
      else {
        // the head reaches halfway into a black neighbour's row
        const a = inside(k + 1) && black(k + 1) ? mid(k + 1) + 1.5 : y0;
        const b = inside(k - 1) && black(k - 1) ? mid(k - 1) - 1.5 : y1;
        heads[k] = (a + b) / 2;
        p.rect(96, y0, 83, y1 - y0);
        bar(p, 179, a, 226, b, Math.min(6, h / 4));
      }
    }
    return p;
  };

  // The field: the range's height, brightest at its two ends
  const yH = mid(hi), yL = mid(lo), tall = yL - yH > 700;
  const fg = g.createLinearGradient(0, yH, 0, yL);
  [[0, '138,196,199,.26'], [tall ? 0.12 : 0.16, '90,159,163,.11'], [0.5, tall ? '90,159,163,.07' : '90,159,163,.06'],
    [tall ? 0.88 : 0.84, '90,159,163,.11'], [1, '138,196,199,.26']].forEach(([o, c]) => fg.addColorStop(o, 'rgba(' + c + ')'));
  g.fillStyle = fg;
  g.fillRect(236, yH, 748, yL - yH);
  for (const [lit, isBlack, colour] of [[false, false, '#262F32'], [false, true, '#1A2123'], [true, false, SEAFOAM], [true, true, '#4F8F93']]) {
    // one bloom for the whole range, under its keys: every key of it lit alike
    if (lit && !isBlack) soft(g, 12, '138,196,199,.55', () => g.fill(keys(true)));
    g.fillStyle = colour;
    g.fill(keys(lit, isBlack));
  }
  for (const [k, s] of Object.entries(d.labels || {})) {
    if (!(k in heads) || k < lo || k > hi) continue;
    // a solfege name is wider: it comes down a size or two to fit the head
    let fs = Math.min(16, Math.max(11, Math.round(h * 0.6)));
    for (face(g, 500, fs); g.measureText(s).width > 32 && fs > 9; face(g, 500, --fs));
    g.textAlign = 'right';
    g.fillStyle = 'rgba(30,38,40,.75)';
    g.fillText(s, 214, heads[k] + 0.365 * fs, 32);
  }

  // The bracket beside the roll, over the WHOLE range from the high note's
  // row to the low note's (never a part of it), and what the range holds
  // centred on it, as the app's picture draws it: the voice type from an
  // octave up, the voice types held whole from three octaves. None under an
  // octave, whatever comes in. The large line comes down 2 px at a time to
  // 30 to fit 640, and past that a pixel at a time rather than be squeezed.
  const br = span >= 12 && d.bracket;
  if (br && br.big) {
    stroke(g, 'M950 ' + yH + 'H962V' + yL + 'H950', 'rgba(127,179,181,.7)', 1.5, 'butt');
    let bs = 44;
    const wide = () => (face(g, 300, bs), g.measureText(br.big).width > 640);
    while (bs > 30 && wide()) bs -= 2;
    while (bs > 20 && wide()) bs--;
    const top = (yH + yL - bs * 1.15 - (br.small ? 4 + 22 * 1.3 : 0)) / 2;
    line(g, br.big, 940, top, { size: bs, weight: 300, lh: bs * 1.15, color: GLOW, align: 'right', max: 640 });
    line(g, br.small, 940, top + bs * 1.15 + 4, { size: 22, lh: 22 * 1.3, color: SLATE, align: 'right', max: 640, min: 16 });
  }

  // The held notes, landing from the right on their keys: a note without
  // its recording gets its landing only, never a made-up line. Returns how
  // high and low the line runs where its Hz label goes, the first 180 px.
  const land = (v, k) => {
    const c = mid(k), pts = v ? v.map((x, i) => [846 - 4 * i, c - clamp(x, 150) / 100 * h]) : [[238, c]];
    trail(g, pts, 7);
    const near = pts.filter(([x]) => x < 420).map((q) => q[1]);
    return [Math.min(...near), Math.max(...near)];
  };
  const tl = resample(d.trails && d.trails.low, 153), th = resample(d.trails && d.trails.high, 153);
  const [lA, lB] = land(tl, lo), [hA, hB] = land(th, hi), hz = d.hz || {};
  const hzText = (v) => String(t.hz || '{hz} Hz').replace('{hz}', num(lang, v, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }));
  if (hz.high) line(g, hzText(hz.high), 256, tall ? hB + 17 : hA - 40, { size: 22, lh: 26, color: SEAFOAM, max: 560 });
  if (hz.low) line(g, hzText(hz.low), 256, tall ? lA - 39 : lB + 20, { size: 22, lh: 26, color: SEAFOAM, max: 560 });

  // Said only when both lines are the singer's: one line, or two smaller
  if (t.caption && tl && th) paint(g, best(g, [[t.caption, SLATE]], { size: 24, one: 20, wrap: 20, lh: 1.4, max: 888, lines: 2, min: 16 }), 96, 1664);
  invite(g, 1726, t.ask, t.site);
  return canvas;
}

export function toFile(canvas, name) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b ? new File([b], name, { type: 'image/png' }) : null), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

const files = (file) => {
  try {
    return !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
};

export const canShare = (file) => files(file) || !!(globalThis.navigator && navigator.share);

// navigator.share runs before the first await, so the tap still counts
export async function share(file, { title, text, url } = {}) {
  let p;
  try {
    if (files(file)) p = navigator.share({ files: [file], title, text });
    else if (navigator.share) p = navigator.share({ title, text, url });
    else return 'unsupported';
    await p;
    return 'shared';
  } catch (e) {
    return e && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export function save(file) {
  const u = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = u;
  a.download = file.name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}
