// mic.js, listener.js and capture.worklet.js against a fake browser: every
// error code, every hint, the order of the Start tap, and the worklet's hops.
//   node --test tool/tests/parity/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  ERRORS, HINTS, checkSupport, classifyError, closeMic, constraints, inAppBrowser,
  isBluetooth, micIsLive, openMic,
} from '../../../js/audio/mic.js';
import { createListener } from '../../../js/audio/listener.js';
import { REPO } from './takes.mjs';

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A725F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-A725F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.27.79 (iPhone15,2; iOS 18_5; en_US)',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.40.71;FBBV/700000000]',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A725F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/500.0.0.47.109;]',
  tiktok: 'Mozilla/5.0 (Linux; Android 14; SM-A725F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 trill_410003 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/41.0.3 ByteLocale/en BytedanceWebview/d8a21c6',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0',
  gmail: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Gmail/6.0.250901',
  webview: 'Mozilla/5.0 (Linux; Android 14; SM-A725F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36',
};

class FakeTrack extends EventTarget {
  constructor({ settings = { sampleRate: 48000, echoCancellation: false }, label = 'Default' } = {}) {
    super();
    this.kind = 'audio';
    this.readyState = 'live';
    this.muted = false;
    this.label = label;
    this._settings = settings;
  }
  getSettings() { return { ...this._settings }; }
  stop() { this.readyState = 'ended'; }
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeStream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}

function denied(name, message = '') {
  return new DOMException(message, name);
}

// A browser with exactly what listener.js touches, logging the order of calls
function fakeBrowser({ ua = UA.chromeAndroid, gum, permission = 'prompt', addModule, resumes = true,
  rate = 48000, track, worklet = true, audioSession } = {}) {
  const env = { log: [], contexts: [], nodes: [], clock: 0, tracks: [], seen: [] };
  class Ctx extends EventTarget {
    constructor(opts) {
      super();
      env.log.push('new AudioContext');
      this.opts = opts;
      this.state = 'suspended';
      this.sampleRate = rate;
      this.destination = {};
      this.audioWorklet = {
        addModule: (url) => {
          env.log.push('addModule');
          env.workletUrl = url;
          return addModule ? addModule(url) : Promise.resolve();
        },
      };
      env.contexts.push(this);
    }
    resume() {
      env.log.push('resume');
      if (resumes) this.state = 'running';
      return Promise.resolve();
    }
    close() {
      env.log.push('close');
      this.state = 'closed';
      return Promise.resolve();
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
  }
  class Node {
    constructor(ctx, name, options) {
      this.name = name;
      this.options = options;
      this.port = { onmessage: null, postMessage: (m) => env.log.push('port ' + m) };
      env.nodes.push(this);
    }
    connect() {}
    disconnect() {}
  }
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const g = new EventTarget();
  Object.assign(g, {
    isSecureContext: true,
    AudioContext: Ctx,
    document: doc,
    performance: { now: () => env.clock },
    navigator: {
      userAgent: ua,
      audioSession,
      permissions: { query: async () => ({ state: permission }) },
      mediaDevices: {
        getUserMedia: (c) => {
          env.log.push('getUserMedia');
          env.seen.push(c);
          if (gum) return gum(env);
          const t = track || new FakeTrack();
          env.tracks.push(t);
          return Promise.resolve(new FakeStream([t]));
        },
      },
    },
  });
  if (worklet) g.AudioWorkletNode = Node;
  env.g = g;
  env.doc = doc;
  env.Ctx = Ctx;
  // One 1024-frame hop into the listener, as the worklet would post it
  env.hop = (frame, samples) => env.nodes[env.nodes.length - 1].port.onmessage({ data: { frame, samples } });
  return env;
}

function sine(hz, n, { amp = 0.2, rate = 48000, from = 0 } = {}) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * (from + i)) / rate);
  return x;
}

// Feed `seconds` of a signal in hops; returns the next frame
function feed(env, seconds, make, from = 0) {
  const hops = Math.ceil((seconds * 48000) / 1024);
  let frame = from;
  for (let h = 0; h < hops; h++) {
    env.hop(frame, make(frame));
    frame += 1024;
  }
  return frame;
}

function listen(env, extra = {}) {
  const calls = { errors: [], hints: [], states: [], readings: [] };
  const listener = createListener({
    global: env.g,
    workletUrl: '/js/audio/capture.worklet.js',
    onError: (c) => calls.errors.push(c),
    onHint: (c, on) => calls.hints.push(c + (on ? '+' : '-')),
    onState: (s) => calls.states.push(s),
    onReading: (r) => calls.readings.push(r),
    ...extra,
  });
  return { listener, calls };
}

test('constraints: plain values, processing off, one channel', () => {
  const c = constraints();
  assert.deepEqual(c.audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 });
  for (const v of Object.values(c.audio)) assert.notEqual(typeof v, 'object');
});

test('in-app browsers by user agent', () => {
  assert.equal(inAppBrowser(UA.instagram), 'instagram');
  assert.equal(inAppBrowser(UA.facebookIos), 'facebook');
  assert.equal(inAppBrowser(UA.facebookAndroid), 'facebook');
  assert.equal(inAppBrowser(UA.tiktok), 'tiktok');
  assert.equal(inAppBrowser(UA.line), 'line');
  assert.equal(inAppBrowser(UA.gmail), 'gmail');
  assert.equal(inAppBrowser(UA.webview), 'webview');
  for (const ua of [UA.chromeAndroid, UA.safariIos, UA.firefox, UA.samsung]) assert.equal(inAppBrowser(ua), null, ua);
});

test('checkSupport', () => {
  assert.equal(checkSupport(fakeBrowser().g), null);
  assert.equal(checkSupport(fakeBrowser({ worklet: false }).g), ERRORS.UNSUPPORTED);
  const insecure = fakeBrowser().g;
  insecure.isSecureContext = false;
  assert.equal(checkSupport(insecure), ERRORS.UNSUPPORTED);
  const noMedia = fakeBrowser({ ua: UA.instagram }).g;
  delete noMedia.navigator.mediaDevices;
  assert.equal(checkSupport(noMedia), ERRORS.IN_APP);
});

test('classifyError: each rejection to its code', () => {
  const slow = { elapsedMs: 2000 };
  assert.equal(classifyError(denied('NotAllowedError'), { ...slow, permission: 'denied' }), ERRORS.BLOCKED);
  assert.equal(classifyError(denied('NotAllowedError'), { ...slow, permission: 'prompt' }), ERRORS.DISMISSED);
  assert.equal(classifyError(denied('NotAllowedError', 'Permission dismissed'), slow), ERRORS.DISMISSED);
  assert.equal(classifyError(denied('NotAllowedError', 'Permission dismissed'), { elapsedMs: 20 }), ERRORS.BLOCKED);
  assert.equal(classifyError(denied('NotAllowedError', 'Permission denied by system'), { ...slow, permission: 'granted' }), ERRORS.BLOCKED);
  assert.equal(classifyError(denied('SecurityError'), slow), ERRORS.BLOCKED);
  assert.equal(classifyError(denied('NotFoundError')), ERRORS.NOT_FOUND);
  assert.equal(classifyError(denied('OverconstrainedError')), ERRORS.NOT_FOUND);
  assert.equal(classifyError(denied('NotReadableError')), ERRORS.BUSY);
  assert.equal(classifyError(denied('AbortError')), ERRORS.BUSY);
  assert.equal(classifyError(new TypeError('x')), ERRORS.UNSUPPORTED);
  assert.equal(classifyError(new Error('?')), ERRORS.FAILED);
  assert.equal(classifyError(denied('NotReadableError'), { inApp: true }), ERRORS.IN_APP);
});

test('isBluetooth: the call profile rate, or a headset label', () => {
  assert.ok(isBluetooth({ sampleRate: 16000 }));
  assert.ok(isBluetooth({ sampleRate: 8000 }));
  assert.ok(!isBluetooth({ sampleRate: 48000 }));
  assert.ok(!isBluetooth({}));
  assert.ok(isBluetooth({ sampleRate: 48000 }, 'AirPods Pro'));
  assert.ok(isBluetooth({}, 'Headset (Bluetooth)'));
});

test('openMic and closeMic: the live set follows the tracks', async () => {
  const env = fakeBrowser();
  const stream = await openMic(env.g);
  assert.deepEqual(env.seen[0], constraints());
  assert.ok(micIsLive());
  closeMic(stream);
  assert.ok(!micIsLive());
  assert.equal(env.tracks[0].readyState, 'ended');
});

test('every code mic.js emits has a string in mic.json, and nothing else', () => {
  const strings = JSON.parse(readFileSync(join(REPO, 'tool/content/ui/en/mic.json'), 'utf8'));
  const codes = [...Object.values(ERRORS), ...Object.values(HINTS)].sort();
  assert.deepEqual(Object.keys(strings).sort(), codes);
  for (const [k, v] of Object.entries(strings)) {
    assert.ok(typeof v === 'string' && v.trim().length > 0, k);
    assert.ok(!/[\u2014\u2013]/.test(v), k + ' has a dash');
  }
});

test('start: the context is made and resumed inside the tap, before the microphone', async () => {
  const env = fakeBrowser();
  const { listener, calls } = listen(env);
  const p = listener.start();
  assert.deepEqual(env.log.slice(0, 3), ['new AudioContext', 'resume', 'getUserMedia']);
  assert.equal(listener.state, 'starting');
  assert.equal(await p, true);
  assert.equal(listener.state, 'listening');
  assert.deepEqual(calls.states, ['starting', 'listening']);
  assert.equal(env.nodes[0].name, 'scalita-capture');
  assert.equal(env.nodes[0].options.processorOptions.hop, 1024);
  assert.equal(listener.start(), p, 'a second start is the same start');
  await listener.stop();
  assert.ok(env.log.includes('close'));
  assert.equal(listener.state, 'stopped');
  assert.ok(!micIsLive());
});

test('readings every 2048 samples, stamped on the context clock', async () => {
  const env = fakeBrowser();
  const { listener, calls } = listen(env);
  await listener.start();
  feed(env, 1, (f) => sine(220, 1024, { from: f }));
  assert.equal(calls.readings.length, 23);
  const r = calls.readings[22];
  assert.equal(r.t, 47104 / 48000);
  assert.ok(Math.abs(r.hz - 220) < 0.05 && r.midi === 57 && r.stable);
  await listener.stop();
});

test('a gap between hops starts a fresh window', async () => {
  const env = fakeBrowser();
  const { listener, calls } = listen(env);
  await listener.start();
  env.hop(0, sine(220, 1024));
  env.hop(4096, sine(220, 1024, { from: 4096 }));
  assert.equal(calls.readings.length, 0);
  env.hop(5120, sine(220, 1024, { from: 5120 }));
  assert.equal(calls.readings.length, 1);
  assert.equal(calls.readings[0].t, 6144 / 48000);
  await listener.stop();
});

test('setTarget narrows the window while listening', async () => {
  const env = fakeBrowser();
  const { listener, calls } = listen(env);
  await listener.start();
  listener.setTarget(60);
  feed(env, 0.1, (f) => sine(98, 1024, { from: f }));
  assert.ok(calls.readings.every((r) => r.outside && r.hz === null));
  await listener.stop();
});

async function failsWith(code, browser, after) {
  const env = fakeBrowser(browser);
  const { listener, calls } = listen(env);
  const ok = await listener.start();
  if (after) {
    assert.equal(ok, true);
    await after(env, listener);
  } else {
    assert.equal(ok, false);
  }
  assert.deepEqual(calls.errors, [code]);
  assert.equal(listener.state, 'stopped');
  assert.ok(!micIsLive(), 'no track left live');
  for (const t of env.tracks) assert.equal(t.readyState, 'ended');
  for (const c of env.contexts) assert.equal(c.state, 'closed');
  return { env, calls };
}

test('micUnsupported: no AudioWorklet, and the mic is never asked', async () => {
  const { env } = await failsWith(ERRORS.UNSUPPORTED, { worklet: false });
  assert.ok(!env.log.includes('getUserMedia'));
});

test('micInApp: any refusal inside an app browser', async () => {
  await failsWith(ERRORS.IN_APP, { ua: UA.instagram, gum: () => Promise.reject(denied('NotAllowedError')) });
});

test('micBlocked: refused before any prompt could show', async () => {
  await failsWith(ERRORS.BLOCKED, { gum: () => Promise.reject(denied('NotAllowedError', 'Permission denied')) });
});

test('micBlocked: refused and remembered', async () => {
  await failsWith(ERRORS.BLOCKED, {
    permission: 'denied',
    gum: (env) => { env.clock += 3000; return Promise.reject(denied('NotAllowedError')); },
  });
});

test('micDismissed: the prompt was shown and closed', async () => {
  await failsWith(ERRORS.DISMISSED, {
    permission: 'prompt',
    gum: (env) => { env.clock += 3000; return Promise.reject(denied('NotAllowedError', 'Permission dismissed')); },
  });
});

test('micNotFound', async () => {
  await failsWith(ERRORS.NOT_FOUND, { gum: () => Promise.reject(denied('NotFoundError')) });
});

test('micBusy', async () => {
  await failsWith(ERRORS.BUSY, { gum: () => Promise.reject(denied('NotReadableError', 'Could not start audio source')) });
});

test('micInterrupted: the track ends while listening', async () => {
  await failsWith(ERRORS.INTERRUPTED, {}, (env) => env.tracks[0].end());
});

test('micInterrupted: the context is interrupted while listening', async () => {
  await failsWith(ERRORS.INTERRUPTED, {}, (env) => {
    const ctx = env.contexts[0];
    ctx.state = 'interrupted';
    ctx.dispatchEvent(new Event('statechange'));
  });
});

test('micHidden: the page goes to the background', async () => {
  await failsWith(ERRORS.HIDDEN, {}, (env) => {
    env.doc.visibilityState = 'hidden';
    env.doc.dispatchEvent(new Event('visibilitychange'));
  });
});

test('micFailed: the worklet will not load', async () => {
  await failsWith(ERRORS.FAILED, { addModule: () => Promise.reject(new Error('404')) });
});

test('micFailed: the context will not run', async () => {
  await failsWith(ERRORS.FAILED, { resumes: false });
});

test('stop while the prompt is up: the mic closes as soon as it arrives', async () => {
  let give;
  const track = new FakeTrack();
  const env = fakeBrowser({ gum: () => new Promise((r) => { give = r; }) });
  const { listener, calls } = listen(env);
  const p = listener.start();
  await listener.stop();
  give(new FakeStream([track]));
  assert.equal(await p, false);
  assert.equal(track.readyState, 'ended');
  assert.deepEqual(calls.errors, []);
  assert.ok(!micIsLive());
});

test('a shared context is used and never closed', async () => {
  const env = fakeBrowser();
  const shared = new env.Ctx();
  shared.state = 'running';
  env.log.length = 0;
  const { listener } = listen(env, { context: shared });
  assert.equal(await listener.start(), true);
  assert.ok(!env.log.includes('new AudioContext') && !env.log.includes('resume'));
  await listener.stop();
  assert.equal(shared.state, 'running');
});

test('a page that set the session to playback hands it back', async () => {
  const audioSession = { type: 'playback' };
  const env = fakeBrowser({ audioSession });
  const { listener } = listen(env);
  const p = listener.start();
  assert.equal(audioSession.type, 'auto');
  await p;
  await listener.stop();
});

test('start again after a stop', async () => {
  const env = fakeBrowser();
  const { listener } = listen(env);
  await listener.start();
  await listener.stop();
  assert.equal(await listener.start(), true);
  assert.equal(env.contexts.length, 2);
  await listener.stop();
});

test('hint micBluetooth: raised at start, cleared at stop', async () => {
  const env = fakeBrowser({ track: new FakeTrack({ settings: { sampleRate: 16000 } }) });
  const { listener, calls } = listen(env);
  await listener.start();
  assert.deepEqual(calls.hints, ['micBluetooth+']);
  assert.ok(listener.hints.has(HINTS.BLUETOOTH));
  await listener.stop();
  assert.deepEqual(calls.hints, ['micBluetooth+', 'micBluetooth-']);
});

test('hint micSilent: two seconds of nothing, or a muted track', async () => {
  const env = fakeBrowser();
  const { listener, calls } = listen(env);
  await listener.start();
  let f = feed(env, 1.9, () => new Float32Array(1024));
  assert.deepEqual(calls.hints, []);
  f = feed(env, 0.2, () => new Float32Array(1024), f);
  assert.deepEqual(calls.hints, ['micSilent+']);
  feed(env, 0.1, (x) => sine(220, 1024, { from: x, amp: 0.001 }), f);
  assert.deepEqual(calls.hints, ['micSilent+', 'micSilent-']);
  env.tracks[0].muted = true;
  env.tracks[0].dispatchEvent(new Event('mute'));
  env.tracks[0].dispatchEvent(new Event('unmute'));
  assert.deepEqual(calls.hints.slice(2), ['micSilent+', 'micSilent-']);
  await listener.stop();
});

test('hint levelQuiet: a voice under the gate for a second', async () => {
  const env = fakeBrowser();
  const { listener, calls } = listen(env);
  await listener.start();
  // amplitude 0.03 is an RMS of 0.021: over the -40 dBFS floor, under the gate
  let f = feed(env, 0.8, (x) => sine(220, 1024, { from: x, amp: 0.03 }));
  assert.deepEqual(calls.hints, []);
  f = feed(env, 0.4, (x) => sine(220, 1024, { from: x, amp: 0.03 }), f);
  assert.deepEqual(calls.hints, ['levelQuiet+']);
  feed(env, 0.1, (x) => sine(220, 1024, { from: x, amp: 0.2 }), f);
  assert.deepEqual(calls.hints, ['levelQuiet+', 'levelQuiet-']);
  await listener.stop();
});

test('hint levelLoud: clipping, three times in a second', async () => {
  const env = fakeBrowser();
  const { listener, calls } = listen(env);
  await listener.start();
  const clipped = (x) => sine(220, 1024, { from: x, amp: 1.2 }).map((v) => Math.max(-1, Math.min(1, v)));
  let f = feed(env, 0.09, clipped);
  assert.deepEqual(calls.hints, [], 'two clipped readings are not yet a hint');
  f = feed(env, 0.05, clipped, f);
  assert.deepEqual(calls.hints, ['levelLoud+']);
  f = feed(env, 2.2, (x) => sine(220, 1024, { from: x, amp: 0.2 }), f);
  assert.deepEqual(calls.hints, ['levelLoud+', 'levelLoud-']);
  await listener.stop();
});

// The worklet runs in its own global scope: load it into a vm with the
// three names it uses from there
function worklet() {
  const posted = [];
  let Processor = null;
  class AudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage: (m, transfer) => posted.push({ m, transfer }) };
    }
  }
  const scope = {
    AudioWorkletProcessor, Float32Array, Math, currentFrame: 0,
    registerProcessor: (name, cls) => { if (name === 'scalita-capture') Processor = cls; },
  };
  vm.createContext(scope);
  vm.runInContext(readFileSync(join(REPO, 'js/audio/capture.worklet.js'), 'utf8'), scope);
  const p = new Processor({ processorOptions: { hop: 1024 } });
  const run = (channels, frame) => {
    scope.currentFrame = frame;
    return p.process([channels]);
  };
  return { p, run, posted };
}

const quantum = (v, n = 128) => new Float32Array(n).fill(v);

test('worklet: 1024-frame hops, transferred, stamped with their first frame', () => {
  const w = worklet();
  for (let q = 0; q < 16; q++) w.run([quantum(q / 100)], q * 128);
  assert.equal(w.posted.length, 2);
  assert.deepEqual(w.posted.map((x) => x.m.frame), [0, 1024]);
  assert.equal(w.posted[0].m.samples.length, 1024);
  assert.equal(w.posted[0].transfer[0], w.posted[0].m.samples.buffer);
  assert.ok(Math.abs(w.posted[1].m.samples[1023] - 0.15) < 1e-6);
});

test('worklet: follows the channel that carries the signal', () => {
  const right = worklet();
  for (let q = 0; q < 8; q++) right.run([quantum(0), quantum(0.5)], q * 128);
  assert.ok(right.posted[0].m.samples.every((v) => Math.abs(v - 0.5) < 1e-6));
  const left = worklet();
  for (let q = 0; q < 8; q++) left.run([quantum(0.5), quantum(0)], q * 128);
  assert.ok(left.posted[0].m.samples.every((v) => Math.abs(v - 0.5) < 1e-6));
});

test('worklet: a gap drops the partial hop; stop ends it; no input is fine', () => {
  const w = worklet();
  w.run([quantum(0.1)], 0);
  for (let q = 0; q < 8; q++) w.run([quantum(0.2)], 4096 + q * 128);
  assert.equal(w.posted.length, 1);
  assert.equal(w.posted[0].m.frame, 4096);
  assert.ok(w.posted[0].m.samples.every((v) => Math.abs(v - 0.2) < 1e-6));
  assert.equal(w.p.process([[]]), true);
  w.p.port.onmessage({ data: 'stop' });
  assert.equal(w.run([quantum(0.1)], 5120), false);
});
