/*
 * The ear test's image: the smallest step heard, in cents, then the six
 * steps as pairs of notes drawing closer, the ones heard lit. Drawn on the
 * reader's device with share-card.js's kit; the save and share helpers are
 * share-card.js's, re-exported.
 *
 *   const card = await import('./share-ear.js');
 *   await card.drawEarCard(canvas, data);
 *
 * data: {lang, date (YYYY-MM-DD), smallest (cents), levels (the steps, in
 * cents), heard (how many were heard), text: {title, value, unit, line,
 * line2, steps (each step's label), pairs, ask, site}}.
 */
import { kit, WIDTH, HEIGHT } from './share-card.js';

export { WIDTH, HEIGHT, toFile, canShare, share, save } from './share-card.js';

const CREAM = '#E8EDEE', SOFT = '#A8B5BA', SLATE = '#7A8B91', SEAFOAM = '#7FB3B5', GLOW = '#8AC4C7', MIST = '#3A4548';

export async function drawEarCard(canvas, d) {
  const { setup, face, num, day, line, best, paint, para, soft, light, invite } = kit;
  const [g, light200] = await setup(canvas);
  const t = d.text || {}, lang = d.lang || 'en';
  const levels = d.levels || [], heard = d.heard || 0;

  const bg = g.createLinearGradient(0, 0, 0, HEIGHT);
  [[0, '#1A2123'], [0.26, '#1E2628'], [0.78, '#1E2628'], [1, '#1A2123']].forEach(([o, c]) => bg.addColorStop(o, c));
  g.fillStyle = bg;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  light(g, 540, 1060, 760, 440, [[0, 0.2], [0.45, 0.07], [0.72, 0]]);

  const date = line(g, day(lang, d.date), 984, 276, { size: 26, lh: 31.2, color: SLATE, align: 'right', max: 400, min: 18 });
  const lay = best(g, [[t.title, SOFT]], { size: 34, one: 26, wrap: 30, lh: 1.2, max: Math.min(600, 856 - date), lines: 2, min: 22 });
  paint(g, lay, 96, 308.8 - lay.rows.length * lay.size * 1.2);

  // The figure, with the unit on its baseline
  const digits = num(lang, Number(t.value)), unit = t.unit || '';
  face(g, 300, 60);
  const wu = unit ? g.measureText(unit).width + 22 : 0;
  face(g, light200, 230, -0.03);
  const size = Math.min(230, Math.floor(230 * (896 - wu) / g.measureText(digits).width));
  const wd = line(g, digits, 88, 312, { size, weight: light200, lh: 230, color: CREAM, track: -0.03 });
  line(g, unit, 88 + wd + 22, 312 + 115 + 0.34 * size - 50.4, { size: 60, weight: 300, lh: 60, color: SOFT, max: 874 - wd, min: 30 });
  const end = paint(g, best(g, [[t.line, CREAM]], { size: 38, one: 34, lh: 1.25, max: 888, lines: 2, min: 30 }), 96, 578);
  paint(g, best(g, [[t.line2, SLATE]], { size: 30, one: 26, lh: 1.3, max: 888, lines: 2, min: 24 }), 96, Math.max(634, end + 8.5));

  // Each step: two notes, a bar each, as far apart as the step is wide
  const col = 888 / Math.max(1, levels.length);
  levels.forEach((cents, i) => {
    const x = 96 + col * i + 24, w = col - 48, gap = 6 + cents * 2.4, on = i < heard;
    const ys = [1060 - gap / 2, 1060 + gap / 2];
    for (const y of ys) {
      const p = new Path2D();
      p.moveTo(x, y);
      p.lineTo(x + w, y);
      if (on) soft(g, 7, '90,159,163,.7', () => {
        g.lineWidth = 12;
        g.lineCap = 'round';
        g.stroke(p);
      });
      g.strokeStyle = on ? GLOW : MIST;
      g.lineWidth = on ? 6 : 4;
      g.lineCap = 'round';
      g.stroke(p);
    }
    line(g, (t.steps || [])[i] || '', x + w / 2, 1220, { size: 26, weight: on ? 500 : 400, lh: 32, color: on ? SEAFOAM : SLATE, align: 'center', max: col - 8, min: 16 });
  });
  para(g, [[t.pairs, SLATE]], 96, 1300, { size: 24, lh: 1.4, max: 888, lines: 3, min: 20 });
  invite(g, 1626, t.ask, t.site);
  return canvas;
}
