/*
 * The microphone, read the way the Scalita app reads it.
 *
 *   import { createListener } from '/js/audio/listener.js';
 *   const listener = createListener({
 *     onReading(r) {},     // every 2048 samples while listening
 *     onError(code) {},    // listening stopped, or never started
 *     onHint(code, on) {}, // advice raised (true) and cleared (false)
 *     onState(state) {},   // 'starting', 'listening', 'stopped'
 *     targetMidi, lowFloorHz, whistleFromMidi,  // optional, see pitch.js
 *     context,             // optional AudioContext to share; never closed here
 *   });
 *   startButton.onclick = () => listener.start();
 *
 * start()  Call it inside the tap handler, synchronously: it creates and
 *   resumes the AudioContext, then asks for the mic (iOS needs that order
 *   inside the tap). Resolves true once audio flows, false when it failed
 *   (onError has fired) or stop() came first. Called while starting or
 *   listening, it returns the same promise; after a stop it starts afresh.
 * stop()   Stops the tracks at once (the mic indicator goes off), then
 *   closes the context if the listener made it. Await it before the piano
 *   plays. Safe at any time.
 * setTarget(midi | null)  Believe only readings within an octave of midi.
 * state, context, sampleRate, settings (the track's getSettings()), hints.
 *
 * A reading: {t, rms, hz, midi, cents, stability, stable, gated, outside,
 *   rawHz, fry, whistle, peak}, documented in pitch.js. t is AudioContext
 *   time in seconds at the end of its 2048 samples, the clock the piano
 *   schedules on. YIN runs every 2048 samples at the context's own rate.
 *   hz, midi and cents are null unless the reading is believed. A reading
 *   with outside set neither counts toward a note nor breaks one; NoteLock
 *   in pitch.js is the app's 600 ms lock.
 *
 * Error codes, each a key in tool/content/ui/<loc>/mic.json:
 *   micUnsupported  no getUserMedia, AudioContext or AudioWorklet, or not https
 *   micInApp        an app's built-in browser (Instagram, Facebook, TikTok...)
 *   micBlocked      refused and remembered, by the browser or the system
 *   micDismissed    the permission prompt closed without an answer
 *   micNotFound     no microphone
 *   micBusy         another app has it, or it would not start
 *   micInterrupted  cut off while listening: a call, an unplugged headset
 *   micHidden       stopped because the page went to the background
 *   micFailed       anything else, the audio engine included
 * Hint codes, also keys in mic.json:
 *   micBluetooth    a headset mic in its phone-call mode
 *   micSilent       nothing at all for 2 s, or the track muted
 *   levelQuiet      a voice under the 0.04 gate for 1 s
 *   levelLoud       clipping, 3 readings in 1 s
 */

import { PitchReader } from './pitch.js';
import { ERRORS, HINTS, checkSupport, openMic, closeMic, trackInfo } from './mic.js';

const SIZE = 2048;
const HOP = 1024;
const WORKLET = '/js/audio/capture.worklet.js';
const SILENT_RMS = 1e-5; // a muted or dead input, never a quiet room
const QUIET_RMS = 0.01; // -40 dBFS: something is there, under the gate
const CLIP = 0.99;

const loaded = new WeakMap();

// Through the page's import map, so the worklet is cache-busted too
function workletUrl() {
  try {
    return import.meta.resolve(WORKLET);
  } catch {
    return WORKLET;
  }
}

function loadWorklet(ctx, url) {
  let p = loaded.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(url);
    loaded.set(ctx, p);
    p.catch(() => loaded.delete(ctx));
  }
  return p;
}

// The worklet into a tool's context before start(), so nothing is fetched
// while a microphone track is live: start() then finds it loaded. False if
// it failed; start() tries again and reports the failure.
export function prepare(ctx, url) {
  return loadWorklet(ctx, url || workletUrl()).then(() => true, () => false);
}

function within(p, ms) {
  let id;
  const timer = new Promise((resolve) => { id = setTimeout(resolve, ms); });
  return Promise.race([p.catch(() => {}), timer]).finally(() => clearTimeout(id));
}

export function createListener(opts = {}) {
  const g = opts.global || globalThis;
  const doc = g.document;
  let state = 'idle', epoch = 0, pending = null;
  let ctx = null, ownsCtx = false, stream = null, track = null, src = null, node = null;
  let reader = null, settings = null, rate = 0;
  let targetMidi = opts.targetMidi == null ? null : opts.targetMidi;
  const buf = new Float32Array(SIZE);
  let fill = 0, expect = -1;
  const hints = new Set();
  let silentFor, quietFor, idleFor, clips, lastClip, muted;

  function setState(s) {
    state = s;
    if (opts.onState) opts.onState(s);
  }

  function hint(code, on) {
    if (hints.has(code) === on) return;
    if (on) hints.add(code);
    else hints.delete(code);
    if (opts.onHint) opts.onHint(code, on);
  }

  function start() {
    if (state === 'starting' || state === 'listening') return pending;
    const my = ++epoch;
    silentFor = quietFor = idleFor = 0;
    clips = [];
    lastClip = -Infinity;
    muted = false;
    setState('starting');
    const unsupported = checkSupport(g);
    if (unsupported) return (pending = Promise.resolve(fail(my, unsupported)));
    try {
      ownsCtx = !opts.context;
      ctx = opts.context || new (g.AudioContext || g.webkitAudioContext)({ latencyHint: 'interactive' });
    } catch {
      return (pending = Promise.resolve(fail(my, ERRORS.FAILED)));
    }
    // Still inside the tap: resume first, then the microphone
    let resumed = Promise.resolve();
    if (ctx.state !== 'running') {
      try {
        resumed = Promise.resolve(ctx.resume());
      } catch {}
    }
    // A page that set 'playback' for the piano hands the session back, so
    // the browser can choose its recording mode
    const session = g.navigator.audioSession;
    if (session && session.type === 'playback') {
      try {
        session.type = 'auto';
      } catch {}
    }
    const mic = openMic(g);
    const mod = loadWorklet(ctx, opts.workletUrl || workletUrl());
    mod.catch(() => {});
    return (pending = run(my, mic, mod, resumed));
  }

  async function run(my, mic, mod, resumed) {
    let s;
    try {
      s = await mic;
    } catch (e) {
      return fail(my, (e && e.code) || ERRORS.FAILED);
    }
    if (my !== epoch) {
      closeMic(s);
      return false;
    }
    stream = s;
    try {
      await mod;
    } catch {
      return fail(my, ERRORS.FAILED);
    }
    await within(resumed, 3000);
    // Opening the mic can move the audio session: one more resume first
    if (my === epoch && ctx.state !== 'running') await within(Promise.resolve().then(() => ctx.resume()), 3000);
    if (my !== epoch) return false;
    if (ctx.state !== 'running') {
      return fail(my, ctx.state === 'interrupted' ? ERRORS.INTERRUPTED : ERRORS.FAILED);
    }
    const info = trackInfo(stream);
    track = info.track;
    settings = info.settings;
    if (track.readyState === 'ended') return fail(my, ERRORS.INTERRUPTED);
    rate = ctx.sampleRate;
    reader = new PitchReader({
      sampleRate: rate, size: SIZE, targetMidi, lowFloorHz: opts.lowFloorHz,
      whistleFromMidi: opts.whistleFromMidi,
    });
    fill = 0;
    expect = -1;
    try {
      src = ctx.createMediaStreamSource(stream);
      node = new g.AudioWorkletNode(ctx, 'scalita-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { hop: HOP },
      });
      node.port.onmessage = (e) => onHop(my, e.data);
      src.connect(node);
      // The graph only pulls what reaches the output; the node writes silence
      node.connect(ctx.destination);
    } catch {
      return fail(my, ERRORS.FAILED);
    }
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);
    ctx.addEventListener('statechange', onContextState);
    if (doc) doc.addEventListener('visibilitychange', onVisibility);
    if (g.addEventListener) g.addEventListener('pagehide', onHidden);
    setState('listening');
    if (info.bluetooth) hint(HINTS.BLUETOOTH, true);
    if (track.muted) onMute();
    if (doc && doc.visibilityState === 'hidden') return fail(my, ERRORS.HIDDEN);
    return my === epoch;
  }

  function onHop(my, msg) {
    if (my !== epoch || state !== 'listening') return;
    const x = msg.samples;
    // A gap since the last hop: a fresh window, never two joined
    if (msg.frame !== expect) fill = 0;
    expect = msg.frame + x.length;
    let i = 0;
    while (i < x.length) {
      const n = Math.min(x.length - i, SIZE - fill);
      buf.set(x.subarray(i, i + n), fill);
      fill += n;
      i += n;
      if (fill === SIZE) {
        fill = 0;
        const r = reader.read(buf, 0, (msg.frame + i) / rate);
        levels(r);
        if (my === epoch && opts.onReading) opts.onReading(r);
        if (my !== epoch) return;
      }
    }
  }

  function levels(r) {
    const dt = SIZE / rate;
    if (r.rms < SILENT_RMS) {
      silentFor += dt;
      if (silentFor >= 2) hint(HINTS.SILENT, true);
    } else {
      silentFor = 0;
      if (!muted) hint(HINTS.SILENT, false);
    }
    if (!r.gated) {
      quietFor = idleFor = 0;
      hint(HINTS.QUIET, false);
    } else if (r.rms >= QUIET_RMS) {
      quietFor += dt;
      idleFor = 0;
      if (quietFor >= 1) hint(HINTS.QUIET, true);
    } else if ((idleFor += dt) >= 2) {
      quietFor = 0;
      hint(HINTS.QUIET, false);
    }
    if (r.peak >= CLIP) clips.push((lastClip = r.t));
    while (clips.length && r.t - clips[0] > 1) clips.shift();
    if (clips.length >= 3) hint(HINTS.LOUD, true);
    else if (r.t - lastClip >= 2) hint(HINTS.LOUD, false);
  }

  function onEnded() {
    fail(epoch, ERRORS.INTERRUPTED);
  }

  function onMute() {
    muted = true;
    hint(HINTS.SILENT, true);
  }

  function onUnmute() {
    muted = false;
    silentFor = 0;
    hint(HINTS.SILENT, false);
  }

  function onContextState() {
    if (ctx.state === 'interrupted' || ctx.state === 'closed') fail(epoch, ERRORS.INTERRUPTED);
    else if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function onVisibility() {
    if (doc.visibilityState === 'hidden') onHidden();
  }

  function onHidden() {
    fail(epoch, ERRORS.HIDDEN);
  }

  function fail(my, code) {
    if (my !== epoch) return false;
    epoch++;
    teardown();
    setState('stopped');
    if (opts.onError) opts.onError(code);
    return false;
  }

  function teardown() {
    if (track) {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', onUnmute);
    }
    if (ctx) ctx.removeEventListener('statechange', onContextState);
    if (doc) doc.removeEventListener('visibilitychange', onVisibility);
    if (g.removeEventListener) g.removeEventListener('pagehide', onHidden);
    try {
      if (node) {
        node.port.onmessage = null;
        node.port.postMessage('stop');
        node.disconnect();
      }
      if (src) src.disconnect();
    } catch {}
    closeMic(stream);
    for (const code of [...hints]) hint(code, false);
    node = src = stream = track = reader = null;
    let done = Promise.resolve();
    if (ctx && ownsCtx && ctx.state !== 'closed') done = ctx.close().catch(() => {});
    ctx = null;
    ownsCtx = false;
    return done;
  }

  function stop() {
    epoch++;
    const done = teardown();
    if (state === 'starting' || state === 'listening') setState('stopped');
    return done;
  }

  function setTarget(midi) {
    targetMidi = midi == null ? null : midi;
    if (reader) reader.setTarget(targetMidi);
  }

  return {
    start,
    stop,
    setTarget,
    get state() { return state; },
    get context() { return ctx; },
    get sampleRate() { return rate; },
    get settings() { return settings; },
    get hints() { return new Set(hints); },
  };
}
