// The microphone: what to ask for, what can go wrong, and what to call it.
// Every code is a key in tool/content/ui/<loc>/mic.json; listener.js
// documents what each one means. A tool can call inAppBrowser() and
// checkSupport() before it shows a Start button at all.

export const ERRORS = Object.freeze({
  UNSUPPORTED: 'micUnsupported',
  IN_APP: 'micInApp',
  BLOCKED: 'micBlocked',
  DISMISSED: 'micDismissed',
  NOT_FOUND: 'micNotFound',
  BUSY: 'micBusy',
  INTERRUPTED: 'micInterrupted',
  HIDDEN: 'micHidden',
  FAILED: 'micFailed',
});

export const HINTS = Object.freeze({
  BLUETOOTH: 'micBluetooth',
  SILENT: 'micSilent',
  QUIET: 'levelQuiet',
  LOUD: 'levelLoud',
});

// Plain values, never `exact`, so a browser that cannot honour one still
// opens the mic. channelCount always: Safari 17 and 18 return stereo with
// only the left channel filled when it is left out.
export function constraints() {
  return {
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    video: false,
  };
}

const IN_APP = [
  ['instagram', /Instagram/],
  ['facebook', /FBAN|FBAV|FB_IAB|FBIOS|FB4A/],
  ['tiktok', /musical_ly|TikTok|BytedanceWebview/i],
  ['line', /\bLine\//],
  ['gmail', /\bGmail\b|GmailApp/i],
  // Any other app's Android WebView: it gets the mic only if the app asks
  ['webview', /; wv\)/],
];

// The in-app browser's name, or null for a real browser
export function inAppBrowser(ua) {
  if (ua === undefined) ua = (globalThis.navigator && globalThis.navigator.userAgent) || '';
  for (const [name, re] of IN_APP) if (re.test(ua)) return name;
  return null;
}

// Null when this browser can listen, else the code to show
export function checkSupport(g = globalThis) {
  const nav = g.navigator;
  const md = nav && nav.mediaDevices;
  const ok = g.isSecureContext !== false && md && typeof md.getUserMedia === 'function'
    && (g.AudioContext || g.webkitAudioContext) && typeof g.AudioWorkletNode === 'function';
  if (ok) return null;
  return inAppBrowser((nav && nav.userAgent) || '') ? ERRORS.IN_APP : ERRORS.UNSUPPORTED;
}

// 'granted', 'denied', 'prompt', or null where the browser will not say
export async function permissionState(g = globalThis) {
  try {
    const status = await g.navigator.permissions.query({ name: 'microphone' });
    return (status && status.state) || null;
  } catch {
    return null;
  }
}

// A refusal this fast means no prompt was shown: the browser decided alone
const NO_PROMPT_MS = 300;

// The code for a getUserMedia rejection; `permission` is the state queried
// after it, `elapsedMs` how long the request took
export function classifyError(err, { inApp = false, permission = null, elapsedMs = Infinity } = {}) {
  if (inApp) return ERRORS.IN_APP;
  switch ((err && err.name) || '') {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      if (permission === 'denied' || elapsedMs < NO_PROMPT_MS) return ERRORS.BLOCKED;
      if (permission === 'prompt' || /dismiss/i.test(String(err.message))) return ERRORS.DISMISSED;
      return ERRORS.BLOCKED;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return ERRORS.NOT_FOUND;
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return ERRORS.BUSY;
    case 'TypeError':
      return ERRORS.UNSUPPORTED;
    default:
      return ERRORS.FAILED;
  }
}

function codeError(code, cause) {
  const e = new Error(code);
  e.code = code;
  e.cause = cause;
  return e;
}

const open = new Set();

// Ask for the microphone. getUserMedia runs before the first await, so
// call it from the Start tap. Resolves to the MediaStream, or rejects with
// an Error whose .code is one of ERRORS.
export async function openMic(g = globalThis) {
  const unsupported = checkSupport(g);
  if (unsupported) throw codeError(unsupported);
  const inApp = !!inAppBrowser(g.navigator.userAgent || '');
  const now = () => (g.performance ? g.performance.now() : Date.now());
  const t0 = now();
  let stream;
  try {
    stream = await g.navigator.mediaDevices.getUserMedia(constraints());
  } catch (err) {
    const elapsedMs = now() - t0;
    const permission = err && err.name === 'NotAllowedError' ? await permissionState(g) : null;
    throw codeError(classifyError(err, { inApp, permission, elapsedMs }), err);
  }
  if (!stream || !stream.getAudioTracks().length) throw codeError(ERRORS.NOT_FOUND);
  open.add(stream);
  return stream;
}

// Stop every track: the mic indicator goes off at once
export function closeMic(stream) {
  if (!stream) return;
  open.delete(stream);
  for (const track of stream.getTracks()) track.stop();
}

// True while a stream from openMic still has a live track. Check it before
// scheduling a piano note: the mic and the piano are never on together.
export function micIsLive() {
  for (const stream of open) {
    if (stream.getTracks().some((t) => t.readyState === 'live')) return true;
  }
  return false;
}

// A Bluetooth headset mic in its phone-call profile (8 or 16 kHz), which
// also drags the phone's output into it
export function isBluetooth(settings, label = '') {
  const rate = settings && settings.sampleRate;
  if (typeof rate === 'number' && rate > 0 && rate <= 16000) return true;
  return /bluetooth|airpods|hands-?free/i.test(label || '');
}

// What the browser actually gave: the track, its settings, whether to warn
export function trackInfo(stream) {
  const track = stream.getAudioTracks()[0];
  const settings = (track.getSettings && track.getSettings()) || {};
  return { track, settings, bluetooth: isBluetooth(settings, track.label) };
}
