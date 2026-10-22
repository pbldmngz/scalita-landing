// Pitch readings made as the app makes them (lib/core/audio/pitch_detector.dart):
// the RMS gate (:218), the accept window (:112-160) and the stability score
// over the last 30 believed readings (:187, :509, :541-557). The lock is the
// range screen's (range_detect_screen.dart:115-122). No microphone here.

import { Yin } from './yin.js';

export const RMS_GATE = 0.04; // about -28 dBFS: quiet singing passes
export const DEFAULT_LOW_HZ = 65; // C2, the floor with no target
export const ABSOLUTE_LOW_HZ = 43; // F1, what 2048 samples resolve at 44.1 kHz
export const HIGH_HZ = 4200; // just above C8
export const TARGET_TOLERANCE = 12; // semitones either side of a target
export const STABLE_AT = 0.8;
// Counted in readings as the app counts them: 1.4 s at 44.1 kHz, 1.3 s at 48
export const STABILITY_READINGS = 30;
export const MIN_READINGS = 10;
export const FRY_BELOW_HZ = 65;
// F6: the app's default whistle span starts here, above its default
// flageolet span (G5 to E6, vocal_register.dart)
export const WHISTLE_FROM_MIDI = 89;

const log2 = (x) => Math.log(x) / Math.LN2;
export const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
export const hzToMidi = (hz) => 12 * log2(hz / 440) + 69; // fractional
export const nearestMidi = (hz) => Math.round(hzToMidi(hz));
export const centsBetween = (hz, refHz) => 1200 * log2(hz / refHz);

// Bounds a reading must fall inside to be believed: an octave either side
// of a target, else 65 to 4200 Hz unless lowFloorHz opens the floor
export function acceptWindow({ targetMidi = null, lowFloorHz = null } = {}) {
  if (targetMidi == null) {
    return {
      low: lowFloorHz == null
        ? DEFAULT_LOW_HZ
        : Math.min(Math.max(lowFloorHz, ABSOLUTE_LOW_HZ), DEFAULT_LOW_HZ),
      high: HIGH_HZ,
    };
  }
  const low = midiToHz(targetMidi - TARGET_TOLERANCE);
  const high = midiToHz(targetMidi + TARGET_TOLERANCE);
  return { low: low < ABSOLUTE_LOW_HZ ? ABSOLUTE_LOW_HZ : low, high: high > HIGH_HZ ? HIGH_HZ : high };
}

// 1 minus the mean cents from the median, over 100; 0 until `min` readings
export class Stability {
  constructor({ size = STABILITY_READINGS, min = MIN_READINGS } = {}) {
    this.size = size;
    this.min = min;
    this.recent = [];
  }

  clear() {
    this.recent.length = 0;
  }

  push(hz) {
    this.recent.push(hz);
    while (this.recent.length > this.size) this.recent.shift();
    return this.value();
  }

  value() {
    const r = this.recent;
    if (r.length < this.min) return 0;
    const sorted = r.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    let total = 0;
    for (const f of r) total += Math.abs(centsBetween(f, median));
    return Math.min(1, Math.max(0, 1 - total / r.length / 100));
  }
}

// read() makes one reading per buffer:
//   t          as passed (listener.js: AudioContext seconds)
//   rms, peak  level, 0 to 1
//   hz         believed pitch, or null when gated, unvoiced or outside
//   midi       nearest note of hz, or null
//   cents      hz against that note, -50 to +50, or null
//   stability  0 to 1, and 0 whenever hz is null
//   stable     stability >= 0.8 (so hz and midi are set)
//   gated      under the gate: silence, and the history restarts
//   outside    a pitch outside the window. The app drops it silently: it
//              neither counts toward a note nor breaks one
//   rawHz      YIN's voiced estimate, believed or not, or null
//   fry        rawHz under 65 Hz
//   whistle    rawHz at or above whistleFromMidi
export class PitchReader {
  constructor({ sampleRate = 44100, size = 2048, targetMidi = null, lowFloorHz = null,
    whistleFromMidi = WHISTLE_FROM_MIDI } = {}) {
    this.size = size;
    this.sampleRate = sampleRate;
    this.yin = new Yin({ size, sampleRate, threshold: 0.2 });
    this.history = new Stability();
    this.lowFloorHz = lowFloorHz;
    this.whistleFromMidi = whistleFromMidi;
    this.setTarget(targetMidi);
  }

  setTarget(midi) {
    this.targetMidi = midi == null ? null : midi;
    this.window = acceptWindow({ targetMidi: this.targetMidi, lowFloorHz: this.lowFloorHz });
  }

  reset() {
    this.history.clear();
  }

  read(x, offset = 0, t = 0) {
    const end = offset + this.size;
    let ss = 0, peak = 0;
    for (let i = offset; i < end; i++) {
      const v = x[i];
      ss += v * v;
      if (v > peak) peak = v;
      else if (-v > peak) peak = -v;
    }
    const rms = Math.sqrt(ss / this.size);
    const r = {
      t, rms, peak, hz: null, midi: null, cents: null, stability: 0, stable: false,
      gated: false, outside: false, rawHz: null, fry: false, whistle: false,
    };
    if (rms < RMS_GATE) {
      r.gated = true;
      this.history.clear();
      return r;
    }
    const f = this.yin.pitch(x, offset);
    if (f === null) {
      this.history.clear();
      return r;
    }
    const frac = hzToMidi(f);
    const midi = Math.round(frac);
    r.rawHz = f;
    r.fry = f < FRY_BELOW_HZ;
    r.whistle = midi >= this.whistleFromMidi;
    if (f < this.window.low || f > this.window.high) {
      r.outside = true;
      return r;
    }
    const s = this.history.push(f);
    r.hz = f;
    r.midi = midi;
    r.cents = (frac - midi) * 100;
    r.stability = s;
    r.stable = s >= STABLE_AT;
    return r;
  }
}

// The range screen's lock: holdMs of stable readings locks the note of the
// first one. An unstable reading cancels, an outside one does not. After a
// lock the next waits for a break, unless reset() (a tool's next phase).
export class NoteLock {
  constructor({ holdMs = 600 } = {}) {
    this.hold = holdMs / 1000;
    this.reset();
  }

  reset() {
    this.since = null;
    this.midi = null;
    this.held = false;
  }

  // The MIDI note when this reading completes a lock, else null
  push(r) {
    if (this.since !== null && r.t - this.since >= this.hold) {
      const midi = this.midi;
      this.since = null;
      this.midi = null;
      this.held = true;
      return midi;
    }
    if (r.outside) return null;
    if (!r.stable) {
      this.since = null;
      this.midi = null;
      this.held = false;
      return null;
    }
    if (!this.held && this.since === null) {
      this.since = r.t;
      this.midi = r.midi;
    }
    return null;
  }
}

// A level meter's position, 0 to 1, for -60 to 0 dBFS, and the gate on it
export function meterLevel(rms) {
  if (!(rms > 0)) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60));
}

export const GATE_LEVEL = meterLevel(RMS_GATE);
