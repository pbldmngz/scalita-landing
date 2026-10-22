// Note runs: the notes a reading stream held for at least minMs, in order,
// the way a singer would name what they sang. Believed readings only; a
// reading outside the window is skipped, as the app skips it. Plain module,
// so the fake-mic page in the browser runs the same code as Node.
export function noteRuns(readings, { minMs = 250, windowSec = 2048 / 44100 } = {}) {
  const out = [];
  let cur = null, start = 0, last = 0;
  const close = () => {
    if (cur !== null && last - start >= minMs / 1000 && out[out.length - 1] !== cur) out.push(cur);
  };
  for (const r of readings) {
    if (r.outside) continue;
    const m = r.hz === null ? null : r.midi;
    if (m !== cur) {
      close();
      cur = m;
      start = r.t - windowSec;
    }
    last = r.t;
  }
  close();
  return out;
}
