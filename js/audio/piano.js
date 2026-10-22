/*
 * piano.js: the app's Salamander piano, played the way
 * lib/core/audio/piano_sampler.dart plays it.
 *
 * Twenty recordings (audio/piano-web/manifest.json, MIDI 33 to 90, every third
 * semitone). A note between plays its nearest one at playbackRate 2^(n/12),
 * one semitone at most, so MIDI 32 to 91 play and anything else gives null.
 * Nothing is fetched and no AudioContext exists before a call that needs
 * audio: make the first one inside a tap. Imported lazily, after the tap?
 * Create and resume a context inside the tap, then hand it to useContext().
 * `when` and `at` are seconds on getContext().currentTime; lengths are ms.
 *
 * init(manifest, base = '/audio/piano-web/')  The manifest or its notes,
 *   {midi, file} each (a sha256 or v adds ?v=). The same again is a no-op.
 * getContext()  The AudioContext, made and resumed on first use.
 * useContext(ctx)  Play through another context (the page's, or offline).
 * prepareRange(low, high, {margin = 7, onProgress(done, total)})  Hold low -
 *   margin to high + margin, let go of the rest; true once all of it is held.
 *   A newer call takes over from an older one.
 * ensureNote(midi)  Its AudioBuffer, loads in flight shared; null if none.
 * playNote(midi, {when = now, ringMs = 6000, fadeMs, velocity = 1})  Rings
 *   ringMs (at most what the sample holds), the last fadeMs fading (30% by
 *   default, 20 at least), and stops 20 ms later. A seventh voice fades the
 *   oldest over 30 ms. Resolves {midi, sample, rate, start, stopAt, stop(ms)}
 *   or null.
 * fadeAll(fadeMs = 250, at = now)  A pedal lift for voices started before at.
 * stopAll()  Silence now, scheduled and loading notes included.
 * release()  stopAll and hand the audio session back: before the mic opens.
 * ringForNote(durationMs) -> [ringMs, fadeMs], ringTimeMsForBpm(bpm) -> ms
 * sampleFor(midi), isPlayable(midi), playableRange() -> {low, high}
 * busyUntil() (0 when silent), isBusy(), whenIdle(), getOutput() for meters
 *
 * The mix is the app's (SoLoud): each mono voice at 0.707 a channel, the sum
 * rounded off (0.87x - 0.1x^3, flat past 1.65) and scaled by 0.95, so levels
 * match the app and a chord never clips.
 */

export const MAX_POLYPHONY = 6;
export const BAND_MARGIN = 7;
export const TAP_RING_MS = 6000;
export const MAX_NOTE_RING_MS = 8000;
export const RELEASE_TAIL_MIN_MS = 120;
export const RELEASE_TAIL_MAX_MS = 400;
export const EVICT_FADE_MS = 30;
export const MAX_SHIFT = 1;
export const DEFAULT_BASE = '/audio/piano-web/';

const EVICT_STOP_MS = 40;
const STOP_AFTER_FADE_MS = 20;
const HARD_STOP_MS = 10;
const LOADS_AT_ONCE = 4;
const HEADROOM = 2;

let notes = [];
let base = DEFAULT_BASE;
let id = null;
let ctx = null;
let owned = false;
let out = null;
const held = new Map();
const loading = new Map();
let bandSeq = 0;
let epoch = 0;
let queue = []; // the app's _activeHandles: eviction order, oldest first
const live = new Set(); // every voice not yet ended
let session = null; // audioSession.type before we set 'playback'

const clamp = (x, lo, hi) => (x > hi ? hi : x >= lo ? x : lo); // NaN gives lo

export function init(manifest, url = DEFAULT_BASE) {
  const list = Array.isArray(manifest) ? manifest : (manifest && manifest.notes) || [];
  const next = list
    .filter((n) => n && Number.isInteger(n.midi) && typeof n.file === 'string')
    .map((n) => ({ midi: n.midi, file: n.file, v: n.v || (n.sha256 ? String(n.sha256).slice(0, 8) : '') }))
    .sort((a, b) => a.midi - b.midi);
  const b = String(url).endsWith('/') ? String(url) : url + '/';
  const key = b + JSON.stringify(next);
  if (key === id) return;
  stopAll();
  notes = next;
  base = b;
  id = key;
  held.clear();
  loading.clear();
  bandSeq++;
}

export function sampleFor(midi) {
  if (!Number.isFinite(midi)) return null;
  const m = Math.round(midi);
  let best = null;
  for (const n of notes) {
    const shift = m - n.midi;
    // Ascending, so on a tie the lower recording wins
    if (Math.abs(shift) <= MAX_SHIFT && (!best || Math.abs(shift) < Math.abs(best.shift))) {
      best = { midi: m, sample: n.midi, shift, rate: 2 ** (shift / 12), file: n.file };
    }
  }
  return best;
}

export const isPlayable = (midi) => sampleFor(midi) !== null;

export function playableRange() {
  if (!notes.length) return null;
  return { low: notes[0].midi - MAX_SHIFT, high: notes[notes.length - 1].midi + MAX_SHIFT };
}

// The app's PianoSampler.ringForNote: the note sounds its whole length, then
// a release tail of half that (120 to 400 ms) which is also its fade, the
// ring capped at 8000 ms.
export function ringForNote(durationMs) {
  const length = clamp(Math.round(durationMs), 1, MAX_NOTE_RING_MS);
  const tail = clamp(Math.round(length * 0.5), RELEASE_TAIL_MIN_MS, RELEASE_TAIL_MAX_MS);
  const ringMs = clamp(length + tail, 1, MAX_NOTE_RING_MS);
  return [ringMs, clamp(tail, 1, ringMs)];
}

// The app's PianoSampler.ringTimeMsForBpm, for sounds with no length of
// their own (cue chords).
export function ringTimeMsForBpm(bpm) {
  if (bpm < 120) return 1000;
  if (bpm < 200) return 400;
  if (bpm < 300) return 200;
  return 120;
}

const isOffline = (c) => typeof c.startRendering === 'function';

export function getContext() {
  // A closed context, ours or one handed over and closed since, plays nothing
  if (!ctx || ctx.state === 'closed') {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not available');
    ctx = new AC({ latencyHint: 'interactive' });
    owned = true;
    out = null;
    // iOS lets a context sound only once something played inside the tap
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.start(0);
  }
  if (!isOffline(ctx) && ctx.state !== 'running' && ctx.state !== 'closed' && ctx.resume) {
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
  }
  return ctx;
}

export function useContext(c) {
  if (c === ctx) return;
  stopAll();
  queue = [];
  live.clear();
  if (ctx && owned && ctx.state !== 'closed') {
    const p = ctx.close();
    if (p && p.catch) p.catch(() => {});
  }
  ctx = c;
  owned = false;
  out = null;
}

function output(c) {
  if (!out || out.context !== c) {
    const gain = c.createGain();
    gain.gain.value = Math.SQRT1_2 / HEADROOM;
    const shaper = c.createWaveShaper();
    const n = 8193;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = ((2 * i) / (n - 1) - 1) * HEADROOM;
      curve[i] = 0.95 * (x >= 1.65 ? 0.9862875 : x <= -1.65 ? -0.9862875 : 0.87 * x - 0.1 * x * x * x);
    }
    shaper.curve = curve;
    gain.connect(shaper);
    shaper.connect(c.destination);
    out = { context: c, gain, shaper };
  }
  return out.gain;
}

export function getOutput() {
  output(getContext());
  return out.shaper;
}

function decode(c, data) {
  return new Promise((resolve, reject) => {
    const p = c.decodeAudioData(data, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

function load(sample) {
  const have = held.get(sample);
  if (have) return Promise.resolve(have);
  const pending = loading.get(sample);
  if (pending) return pending;
  const n = notes.find((x) => x.midi === sample);
  const c = getContext();
  const mine = id;
  const p = new Promise((resolve) => resolve(globalThis.fetch(base + n.file + (n.v ? '?v=' + n.v : ''))))
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    })
    .then((data) => decode(c, data))
    .then(
      (buf) => {
        if (mine === id) held.set(sample, buf);
        return buf;
      },
      () => null,
    )
    .finally(() => {
      if (loading.get(sample) === p) loading.delete(sample);
    });
  loading.set(sample, p);
  return p;
}

export function ensureNote(midi) {
  const s = sampleFor(midi);
  return s ? load(s.sample) : Promise.resolve(null);
}

export async function prepareRange(low, high, { margin = BAND_MARGIN, onProgress } = {}) {
  const r = playableRange();
  if (!r) return false;
  const lo = clamp(Math.round(Math.min(low, high)) - margin, r.low, r.high);
  const hi = clamp(Math.round(Math.max(low, high)) + margin, r.low, r.high);
  const seq = ++bandSeq;
  const need = [];
  for (let m = lo; m <= hi; m++) {
    const s = sampleFor(m);
    if (s && !need.includes(s.sample)) need.push(s.sample);
  }
  for (const k of [...held.keys()]) if (!need.includes(k)) held.delete(k);
  let next = 0;
  let done = 0;
  if (onProgress) onProgress(done, need.length);
  const worker = async () => {
    while (next < need.length && seq === bandSeq) {
      await load(need[next++]);
      done++;
      if (onProgress) onProgress(done, need.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOADS_AT_ONCE, need.length) }, worker));
  return need.every((k) => held.has(k));
}

function claimSession() {
  const s = globalThis.navigator && globalThis.navigator.audioSession;
  if (!s || s.type === 'playback') return;
  if (session === null) session = s.type;
  try {
    s.type = 'playback';
  } catch {}
}

export function playNote(midi, { when, ringMs = TAP_RING_MS, fadeMs, velocity = 1 } = {}) {
  const s = sampleFor(midi);
  if (!s) return Promise.resolve(null);
  getContext();
  claimSession();
  const buf = held.get(s.sample);
  if (buf) return Promise.resolve(start(s, buf, when, ringMs, fadeMs, velocity));
  const e = epoch;
  return load(s.sample).then((b) => (b && e === epoch ? start(s, b, when, ringMs, fadeMs, velocity) : null));
}

function start(s, buf, when, ringMs, fadeMs, velocity) {
  const c = getContext();
  const now = c.currentTime;
  const t0 = Math.max(Number.isFinite(when) ? when : now, now);
  // The app clamps to its sample length; here the sample ends at its own fade
  const ring = clamp(Math.round(ringMs), 1, Math.max(1, Math.floor((buf.duration / s.rate) * 1000)));
  const fadeLen = Math.min(Math.max(fadeMs == null ? Math.round(ring * 0.3) : Math.round(fadeMs), 20), ring);
  const vel = clamp(velocity, 0, 1);
  makeRoom(t0);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = s.rate;
  const g = c.createGain();
  const fadeAt = t0 + (ring - fadeLen) / 1000;
  const end = t0 + ring / 1000;
  g.gain.setValueAtTime(vel, t0);
  g.gain.setValueAtTime(vel, fadeAt);
  g.gain.linearRampToValueAtTime(0, end);
  src.connect(g);
  g.connect(output(c));
  const v = {
    midi: s.midi,
    sample: s.sample,
    rate: s.rate,
    start: t0,
    stopAt: end + STOP_AFTER_FADE_MS / 1000,
    src,
    gain: g,
    env: [[t0, vel], [fadeAt, vel], [end, 0]],
  };
  v.stop = (ms = HARD_STOP_MS) => {
    drop(v);
    fadeVoice(v, c.currentTime, ms, ms);
  };
  src.onended = () => {
    live.delete(v);
    drop(v);
    try {
      g.disconnect();
    } catch {}
  };
  src.start(t0);
  src.stop(v.stopAt);
  queue.push(v);
  live.add(v);
  return v;
}

function drop(v) {
  const i = queue.indexOf(v);
  if (i >= 0) queue.splice(i, 1);
}

// The app's polyphony limit, at the moment the new note starts
function makeRoom(t) {
  queue = queue.filter((v) => v.stopAt > t);
  while (queue.length >= MAX_POLYPHONY) fadeVoice(queue.shift(), t, EVICT_FADE_MS, EVICT_STOP_MS);
}

function level(env, t) {
  for (let i = 0; i < env.length; i++) {
    const [t1, y1] = env[i];
    if (t < t1) {
      if (i === 0) return y1;
      const [t0, y0] = env[i - 1];
      return y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
    }
  }
  return env.length ? env[env.length - 1][1] : 0;
}

// Fade v to silence from t over fadeMs and stop it at t + stopMs. The ramp up
// to t is kept as it was, so a fade scheduled ahead does not jump.
function fadeVoice(v, t, fadeMs, stopMs) {
  const g = v.gain.gain;
  t = Math.max(t, v.src.context.currentTime);
  if (t >= v.stopAt) return;
  if (t <= v.start) {
    // Not sounding yet, and now it never will
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    v.env = [[t, 0]];
    v.stopAt = t;
    try {
      v.src.stop(t);
    } catch {}
    return;
  }
  const y = level(v.env, t);
  const end = t + fadeMs / 1000;
  g.cancelScheduledValues(t);
  g.linearRampToValueAtTime(y, t);
  g.linearRampToValueAtTime(0, end);
  v.env = v.env.filter((p) => p[0] < t).concat([[t, y], [end, 0]]);
  const stopAt = t + stopMs / 1000;
  if (stopAt < v.stopAt) {
    v.stopAt = stopAt;
    try {
      v.src.stop(stopAt);
    } catch {}
  }
}

export function fadeAll(fadeMs = 250, at) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const t = Math.max(Number.isFinite(at) ? at : now, now);
  const keep = [];
  for (const v of queue) {
    if (v.start < t) fadeVoice(v, t, fadeMs, fadeMs + STOP_AFTER_FADE_MS);
    else keep.push(v);
  }
  queue = keep;
}

export function stopAll() {
  epoch++;
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const v of live) fadeVoice(v, t, HARD_STOP_MS, HARD_STOP_MS);
  queue = [];
}

export function release() {
  stopAll();
  const s = globalThis.navigator && globalThis.navigator.audioSession;
  if (s && session !== null) {
    try {
      s.type = session;
    } catch {}
  }
  session = null;
}

export function busyUntil() {
  if (!ctx) return 0;
  let t = 0;
  for (const v of live) if (v.stopAt > t) t = v.stopAt;
  return t > ctx.currentTime ? t : 0;
}

export const isBusy = () => busyUntil() > 0;

export function whenIdle() {
  return new Promise((resolve) => {
    const check = () => {
      const t = busyUntil();
      if (!t) resolve();
      else setTimeout(check, Math.max(10, (t - ctx.currentTime) * 1000 + 5));
    };
    check();
  });
}
