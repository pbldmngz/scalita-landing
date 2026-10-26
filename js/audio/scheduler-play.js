/*
 * scheduler-play.js: plays a timeline scheduler.js compile()d, on the audio
 * clock (playback_engine.dart's timing). Its own module so that nothing of it
 * loads before the first Play: player.js imports it then, with piano.js.
 *
 * play(timeline, {piano, context, onEvent}) -> {stop(), done}: schedules it
 *   ahead through piano.js; onEvent(e) fires once e sounds.
 */
import { CLEAR_FADE_MS } from './scheduler.js';

// The count-in's click: a short sine, the app's beep at its volume
function click(ctx, when, live) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.15, when);
  g.gain.linearRampToValueAtTime(0, when + 0.08);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(when);
  o.stop(when + 0.1);
  live.add(o);
  o.onended = () => live.delete(o);
}

// Schedule a compiled timeline lookaheadMs ahead of context.currentTime
// through piano (piano.js: playNote, fadeAll, ringForNote, ringTimeMsForBpm),
// and hand each event to onEvent once it sounds. rate > 1 plays it faster
// (tests). done resolves 'end' or 'stopped'.
export function play(timeline, {
  piano,
  context,
  onEvent = () => {},
  rate = 1,
  leadMs = 120,
  lookaheadMs = 300,
  tickMs = 25,
  timers = globalThis,
}) {
  const events = timeline.events;
  const t0 = context.currentTime + leadMs / 1000;
  let slide = 0;
  const at = (e) => t0 + slide + e.t / rate / 1000;
  const voices = new Set();
  const clicks = new Set();
  const due = [];
  let i = 0;
  let stopped = false;
  let finish;
  const done = new Promise((r) => (finish = r));
  const keep = (p) => {
    if (p && p.then) {
      p.then((v) => {
        if (!v) return;
        if (stopped) v.stop();
        else voices.add(v);
      });
    }
  };
  const schedule = (e, now) => {
    // A stalled timer (a hidden tab) finds the next event already past: the
    // rest slides along rather than sounding all at once
    if (at(e) < now - 0.02) slide += now - at(e) + 0.02;
    const when = at(e);
    if (e.type === 'note') {
      const [ringMs, fadeMs] = piano.ringForNote(e.durMs);
      keep(piano.playNote(e.midi, { when, ringMs: ringMs / rate, fadeMs: fadeMs / rate, velocity: 1 }));
    } else if (e.type === 'chord') {
      let ring = piano.ringTimeMsForBpm(e.bpm);
      if (e.capMs !== null && e.capMs !== undefined) ring = Math.max(50, Math.min(ring, e.capMs));
      for (const m of e.notes) keep(piano.playNote(m, { when, ringMs: ring / rate, velocity: e.volume }));
    } else if (e.type === 'fade') {
      piano.fadeAll(e.fadeMs / rate, when);
    } else if (e.type === 'count') {
      click(context, when, clicks);
    }
    due.push([when, e]);
  };
  const tick = () => {
    if (stopped) return;
    const now = context.currentTime;
    while (i < events.length && at(events[i]) <= now + lookaheadMs / 1000) schedule(events[i++], now);
    while (due.length && due[0][0] <= now) {
      const e = due.shift()[1];
      onEvent(e);
      if (e.type === 'end') return end('end');
      if (stopped) return;
    }
    for (const v of voices) if (v.stopAt <= now) voices.delete(v);
  };
  const timer = timers.setInterval(tick, tickMs);
  const end = (reason) => {
    if (stopped) return;
    stopped = true;
    timers.clearInterval(timer);
    finish(reason);
  };
  tick();
  return {
    startTime: t0,
    done,
    stop() {
      if (stopped) return;
      end('stopped');
      const now = context.currentTime;
      // The app's stop: what sounds fades over 60 ms, what is still ahead never starts
      for (const v of voices) {
        if (v.start > now) v.stop();
        else v.stop(CLEAR_FADE_MS);
      }
      voices.clear();
      for (const o of clicks) {
        try {
          o.stop();
        } catch {}
      }
      clicks.clear();
    },
  };
}
