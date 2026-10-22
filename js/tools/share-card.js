/*
 * A result card to share, drawn on a canvas on the reader's device: Stories
 * size (1080 x 1920), the site's colours and font, the page's own words.
 * Nothing is uploaded and no third-party script runs: the image goes out
 * through the Web Share API or is saved as a file. Shared by the tools;
 * load it on demand, after a result.
 *
 *   const card = await import('/js/tools/share-card.js');
 *   await card.drawCard(canvas, {kicker, title, sub, big, lines, keys, site, footer});
 *   const file = await card.toFile(canvas, 'my-vocal-range.png');
 *   card.canShare(file)   true where share() can do something
 *   card.share(file, {title, text, url})  call it inside the tap; resolves
 *                         'shared', 'cancelled', 'failed' or 'unsupported'
 *   card.save(file)       a download of the image
 *
 * Every field is optional text but keys: {from, to, low, high} (MIDI) draws a
 * keyboard from `from` to `to` with low to high lit. Long lines wrap onto two
 * and shrink to fit.
 */

export const WIDTH = 1080;
export const HEIGHT = 1920;
const FONT = "'Sora', -apple-system, 'Segoe UI', sans-serif";
const MAX = WIDTH - 160;

function token(name, fallback) {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

// '#5A9FA3' at alpha a
function alpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
}

// Sora draws on a canvas only once loaded; a second and a half at most
async function fonts() {
  const f = globalThis.document && document.fonts;
  if (!f || !f.load) return;
  const all = Promise.all(['300 150px', '400 56px', '500 56px'].map((s) => f.load(s + ' Sora').catch(() => {})));
  await Promise.race([all, new Promise((r) => setTimeout(r, 1500))]);
}

function wrap(g, text, max) {
  const out = [];
  let line = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = line ? line + ' ' + w : w;
    if (line && g.measureText(t).width > max) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

// Writes text centred under y in at most `lines` lines, shrinking from size
// to min until it fits; returns the new bottom
function write(g, text, y, weight, size, min, colour, lines) {
  if (!text) return y;
  let s = size, out;
  for (;;) {
    g.font = weight + ' ' + s + 'px ' + FONT;
    out = wrap(g, text, MAX);
    if ((out.length <= lines && out.every((l) => g.measureText(l).width <= MAX)) || s <= min) break;
    s -= 4;
  }
  g.fillStyle = colour;
  for (const l of out.slice(0, lines)) {
    y += s * 1.22;
    g.fillText(l, WIDTH / 2, y, MAX);
  }
  return y;
}

function key(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, [0, 0, r, r]);
  else g.rect(x, y, w, h);
  g.fill();
}

function keyboard(g, { from, to, low, high }, top, c) {
  const black = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
  const whites = [];
  for (let m = from; m <= to; m++) if (!black(m)) whites.push(m);
  if (!whites.length) return;
  const w = Math.min(64, MAX / whites.length), h = Math.min(300, w * 4.6);
  const x0 = (WIDTH - w * whites.length) / 2;
  const lit = (m) => m >= low && m <= high;
  whites.forEach((m, i) => {
    g.fillStyle = lit(m) ? c.ocean : c.light;
    key(g, x0 + i * w + 2, top, w - 4, h, Math.min(10, w / 4));
  });
  for (let m = from; m <= to; m++) {
    if (!black(m)) continue;
    const i = whites.findIndex((x) => x > m);
    if (i <= 0) continue;
    g.fillStyle = lit(m) ? c.glow : c.mist;
    key(g, x0 + i * w - w * 0.31, top, w * 0.62, h * 0.6, Math.min(8, w / 5));
  }
}

export async function drawCard(canvas, card = {}) {
  await fonts();
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const g = canvas.getContext('2d');
  const c = {
    base: token('--base', '#1E2628'), surface: token('--surface', '#252D30'),
    light: token('--surface-light', '#2D373A'), mist: token('--mist', '#3A4548'),
    cream: token('--cream', '#E8EDEE'), soft: token('--soft', '#A8B5BA'), slate: token('--slate', '#7A8B91'),
    ocean: token('--ocean', '#5A9FA3'), seafoam: token('--seafoam', '#7FB3B5'), glow: token('--glow', '#8AC4C7'),
  };
  const bg = g.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, c.surface);
  bg.addColorStop(1, c.base);
  g.fillStyle = bg;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  // The one accent: a soft light behind the numbers
  const light = g.createRadialGradient(WIDTH / 2, 820, 40, WIDTH / 2, 820, 640);
  light.addColorStop(0, alpha(c.ocean, 0.22));
  light.addColorStop(1, alpha(c.ocean, 0));
  g.fillStyle = light;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  let y = 230;
  y = write(g, card.kicker, y, 500, 56, 36, c.soft, 1);
  y = write(g, card.title, y + 80, 300, 150, 72, c.cream, 2);
  y = write(g, card.sub, y + 16, 400, 56, 36, c.slate, 1);
  y = write(g, card.big, y + 120, 300, 170, 80, c.glow, 1);
  for (const l of card.lines || []) y = write(g, l, y + 36, 400, 58, 36, c.cream, 2);
  if (card.keys) keyboard(g, card.keys, Math.max(y + 110, 1260), c);
  write(g, card.site, 1640, 500, 64, 40, c.seafoam, 1);
  write(g, card.footer, 1720, 400, 46, 30, c.slate, 1);
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
