/*
 * The sing-in-tune image (SH-B-tune-strong, SH-B-tune-modest): the typical
 * miss in cents, then the five notes sung back, each line the singer's own
 * voice landing on the note inside the 10 and 25 cent bands. Drawn on the
 * reader's device with share-card.js's kit; the save and share helpers are
 * share-card.js's, re-exported.
 *
 *   const card = await import('./share-tune.js');
 *   await card.drawTuneCard(canvas, data);
 *
 * data: {lang, date (YYYY-MM-DD), off, judged, total, inTune, close, wobble,
 * notes: [{name, cents | null, path: cents over time | null}] (five, in
 * order), text: {title, cents, typical, line2, bandClose, bandIn, theNote,
 * lines, ask, site}}. A note not heard gets its name only; a heard note
 * without its path gets its landing only, never a made-up line.
 */
import { kit, WIDTH, HEIGHT } from './share-card.js';

export { WIDTH, HEIGHT, toFile, canShare, share, save } from './share-card.js';

const CREAM = '#E8EDEE', SOFT = '#A8B5BA', SLATE = '#7A8B91', SEAFOAM = '#7FB3B5';

export async function drawTuneCard(canvas, d) {
  const { setup, face, num, day, line, best, paint, para, soft, light, trail, resample, clamp, invite } = kit;
  const [g, light200] = await setup(canvas);
  const t = d.text || {}, lang = d.lang || 'en';

  // The notes first: how low the lowest line goes places their labels
  const slots = [0, 1, 2, 3, 4].map((i) => {
    const n = (d.notes || [])[i] || {}, x = 102 + 160.8 * i, heard = Number.isFinite(n.cents);
    const v = heard && resample(n.path, 50);
    const pts = v ? v.map((c, k) => [x + 3 * k, 1060 - clamp(c, 70) * 3])
      : heard ? [[x + 147, 1060 - clamp(n.cents, 70) * 3]] : null;
    return { n, pts, x: x + 74 };
  });
  const low = Math.max(1060, ...slots.flatMap((s) => (s.pts || []).map((p) => p[1])));

  const bg = g.createLinearGradient(0, 0, 0, HEIGHT);
  [[0, '#1A2123'], [0.26, '#1E2628'], [0.78, '#1E2628'], [1, '#1A2123']].forEach(([o, c]) => bg.addColorStop(o, c));
  g.fillStyle = bg;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  const deep = low > 1200;
  light(g, 540, deep ? 1070 : 1060, 760, deep ? 460 : 420, [[0, 0.22], [0.45, 0.08], [0.72, 0]]);

  // The note and its bands, 3 px a cent, fading out at both sides
  const fade = g.createLinearGradient(0, 0, WIDTH, 0);
  [[0, 0], [0.12, 1], [0.88, 1], [1, 0]].forEach(([o, a]) => fade.addColorStop(o, 'rgba(127,179,181,' + a + ')'));
  const rule = (y, w, a) => {
    g.globalAlpha = a;
    g.strokeStyle = fade;
    g.lineWidth = w;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(WIDTH, y);
    g.stroke();
  };
  g.fillStyle = fade;
  g.globalAlpha = 0.05;
  g.fillRect(0, 985, WIDTH, 150);
  g.globalAlpha = 0.11;
  g.fillRect(0, 1030, WIDTH, 60);
  rule(985, 1, 0.14);
  rule(1135, 1, 0.14);
  rule(1030, 1, 0.22);
  rule(1090, 1, 0.22);
  g.globalAlpha = 1;
  soft(g, 7, '127,179,181,.4', () => rule(1060, 10, 1));
  rule(1060, 2, 1);

  // The landings joined in order, then each voice
  g.setLineDash([2, 6]);
  g.strokeStyle = 'rgba(232,237,238,.16)';
  g.lineWidth = 1;
  g.beginPath();
  slots.filter((s) => s.pts).forEach((s, i) => g[i ? 'lineTo' : 'moveTo'](...s.pts[s.pts.length - 1]));
  g.stroke();
  g.setLineDash([]);
  for (const s of slots) if (s.pts) trail(g, s.pts, 6.5);

  const date = line(g, day(lang, d.date), 984, 276, { size: 26, lh: 31.2, color: SLATE, align: 'right', max: 400, min: 18 });
  // The title fits beside the date, or takes two lines that end where one would
  const lay = best(g, [[t.title, SOFT]], { size: 34, one: 26, wrap: 30, lh: 1.2, max: Math.min(600, 856 - date), lines: 2, min: 22 });
  paint(g, lay, 96, 308.8 - lay.rows.length * lay.size * 1.2);

  // The figure, with the unit on its baseline
  const digits = num(lang, Math.round(d.off)), unit = t.cents || '';
  face(g, 300, 60);
  const wu = unit ? g.measureText(unit).width + 22 : 0;
  face(g, light200, 230, -0.03);
  const size = Math.min(230, Math.floor(230 * (896 - wu) / g.measureText(digits).width));
  const wd = line(g, digits, 88, 312, { size, weight: light200, lh: 230, color: CREAM, track: -0.03 });
  line(g, unit, 88 + wd + 22, 312 + 115 + 0.34 * size - 50.4, { size: 60, weight: 300, lh: 60, color: SOFT, max: 874 - wd, min: 30 });
  // one line a little smaller rather than a word alone on a second
  const end = paint(g, best(g, [[t.typical, CREAM]], { size: 38, one: 34, lh: 1.25, max: 888, lines: 2, min: 30 }), 96, 578);
  paint(g, best(g, [[t.line2, SLATE]], { size: 30, one: 26, lh: 1.3, max: 888, lines: 2, min: 24 }), 96, Math.max(634, end + 8.5));

  line(g, t.bandClose, 1064, 957, { size: 18, lh: 21.6, color: SLATE, align: 'right', max: 150, min: 14 });
  line(g, t.bandIn, 1064, 1002, { size: 18, lh: 21.6, color: SOFT, align: 'right', max: 150, min: 14 });
  line(g, t.theNote, 1064, 1066, { size: 18, weight: 500, lh: 21.6, color: SEAFOAM, align: 'right', max: 150, min: 14 });

  // Each note's name, and how far it landed, under the lowest line
  const top = Math.max(1262, low + 32);
  for (const { n, x } of slots) {
    line(g, n.name, x, top, { size: 30, weight: 500, lh: 36, color: CREAM, align: 'center', max: 150, min: 20 });
    if (Number.isFinite(n.cents)) {
      const r = Math.round(n.cents), a = num(lang, Math.abs(r));
      line(g, r > 0 ? '+' + a : r < 0 ? '\u2212' + a : a, x, top + 42, { size: 24, lh: 28.8, color: SEAFOAM, align: 'center', max: 150 });
    }
  }
  para(g, [[t.lines, SLATE]], 96, top + 110, { size: 24, lh: 1.4, max: 888, lines: 4, min: 20 });
  invite(g, 1626, t.ask, t.site);
  return canvas;
}
