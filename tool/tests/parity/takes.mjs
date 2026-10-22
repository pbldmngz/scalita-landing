// Where the voice takes are, and how to read them. The takes stay in the
// app repo: nothing here copies them, and nothing generated is written
// next to this file.
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');
export const fixtures = JSON.parse(readFileSync(join(HERE, 'fixtures.json'), 'utf8'));

// SCALITA_TAKES, else the sibling app checkout. null when neither is there.
export function takesDir() {
  const dir = process.env.SCALITA_TAKES || resolve(HERE, fixtures.takesDir);
  return existsSync(dir) ? dir : null;
}

// SCALITA_SCRATCH, else the system temp folder
export function scratchDir(name) {
  return join(process.env.SCALITA_SCRATCH || join(tmpdir(), 'scalita-tests'), name);
}

// 16-bit PCM mono: { rate, samples } with samples as Float64Array in -1..1
export function readWav(path) {
  const b = readFileSync(path);
  let pos = 12, rate = 0, channels = 0, bits = 0;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      channels = b.readUInt16LE(pos + 10);
      rate = b.readUInt32LE(pos + 12);
      bits = b.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      if (channels !== 1 || bits !== 16) throw new Error(`${path}: want 16-bit mono`);
      const n = size >> 1;
      const samples = new Float64Array(n);
      for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(pos + 8 + i * 2) / 32768;
      return { rate, samples };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error(`${path}: no data chunk`);
}
