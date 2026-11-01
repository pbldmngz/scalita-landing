/*
 * Keeps the screen on while a tool runs. Someone singing does not touch the
 * phone, so it dims and locks after its timeout and the microphone or the
 * piano stops with it (an iPhone after 30 s by default).
 *
 *   keepAwake(key, on)  on: a tool started (the microphone listens, the
 *                       piano plays); off: it stopped. The screen stays on
 *                       while any key is held.
 *
 * The browser drops the lock whenever the page is hidden; it is asked for
 * again when the page shows and a key is still held. Where the Screen Wake
 * Lock API is missing (Safari before 16.4, Firefox before 126) or refuses
 * (a battery saver, a policy), nothing happens and nothing is said.
 * Loaded on the tap that starts a tool, never with the page.
 */

const held = new Set();
let lock = null;
let asking = null;

function ask() {
  const api = globalThis.navigator && navigator.wakeLock;
  if (!api || lock || asking || !held.size || document.visibilityState !== 'visible') return;
  asking = api.request('screen').then((s) => {
    asking = null;
    if (!held.size) return s.release().catch(() => {});
    lock = s;
    s.addEventListener('release', () => { if (lock === s) lock = null; });
  }, () => { asking = null; });
}

function letGo() {
  const s = lock;
  lock = null;
  if (s) s.release().catch(() => {});
}

export function keepAwake(key, on) {
  if (on) held.add(key);
  else held.delete(key);
  if (held.size) ask();
  else letGo();
}

export const isHeld = () => !!lock;

if (globalThis.document) document.addEventListener('visibilitychange', ask);
