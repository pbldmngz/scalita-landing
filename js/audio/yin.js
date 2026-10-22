// YIN (de Cheveigné and Kawahara 2002), ported line by line from the app's
// lib/core/audio/yin.dart, which explains every step. Same operations in the
// same order, so both read the same audio to within 1e-6 cents: change one,
// change the other, and rerun tool/tests/parity/parity.mjs.

export class Yin {
  constructor({ size = 2048, sampleRate = 44100, threshold = 0.2 } = {}) {
    this.size = size;
    this.sampleRate = sampleRate;
    this.threshold = threshold;
    this._half = size >> 1;
    let n = 1;
    while (n < size) n <<= 1;
    this._n = n;
    this._re = new Float64Array(n);
    this._im = new Float64Array(n);
    this._energy = new Float64Array(size + 1);
    this._cmnd = new Float64Array(this._half);
    this._cos = new Float64Array(n >> 1);
    this._sin = new Float64Array(n >> 1);
    for (let k = 0; k < n >> 1; k++) {
      const a = (-2 * Math.PI * k) / n;
      this._cos[k] = Math.cos(a);
      this._sin[k] = Math.sin(a);
    }
    let bits = 0;
    while (1 << bits < n) bits++;
    this._reversed = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this._reversed[i] = r;
    }
  }

  // Hz of x[offset, offset + size), or null when unvoiced
  pitch(x, offset = 0) {
    const r = this.analyse(x, offset);
    return r !== null && r.voiced ? r.frequency : null;
  }

  // {frequency, aperiodicity, voiced}, or null for all zeros
  analyse(x, offset = 0) {
    const half = this._half;
    this._difference(x, offset);
    const d = this._cmnd;

    // Step 3: cumulative mean normalisation
    d[0] = 1;
    let sum = 0;
    for (let tau = 1; tau < half; tau++) {
      sum += d[tau];
      d[tau] = sum > 0 ? (d[tau] * tau) / sum : 1;
    }
    if (sum <= 0) return null;

    // Step 4: the first dip under the threshold, down to its minimum
    let tau = 2;
    let voiced = false;
    for (; tau < half; tau++) {
      if (d[tau] < this.threshold) {
        while (tau + 1 < half && d[tau + 1] < d[tau]) tau++;
        voiced = true;
        break;
      }
    }
    if (!voiced) {
      tau = 2;
      for (let t = 3; t < half; t++) if (d[t] < d[tau]) tau = t;
    }

    // Step 5: parabolic interpolation on d'
    let period = tau;
    if (tau + 1 < half) {
      const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1];
      const den = 2 * (s0 - 2 * s1 + s2);
      if (den !== 0) period += (s0 - s2) / den;
    }
    return { frequency: this.sampleRate / period, aperiodicity: d[tau], voiced };
  }

  // Step 2: the difference function by FFT (the paper's equation 7)
  _difference(x, offset) {
    const half = this._half, n = this._n, size = this.size;
    const re = this._re, im = this._im, energy = this._energy;

    energy[0] = 0;
    let acc = 0;
    for (let j = 0; j < size; j++) {
      const v = x[offset + j];
      acc += v * v;
      energy[j + 1] = acc;
    }

    for (let j = 0; j < n; j++) {
      re[j] = j < half ? x[offset + j] : 0;
      im[j] = j < size ? x[offset + j] : 0;
    }
    this._transform(re, im);

    for (let k = 0; k <= n >> 1; k++) {
      const m = (n - k) & (n - 1);
      const ur = re[k], ui = im[k], vr = re[m], vi = im[m];
      const imUv = ur * vi + ui * vr;
      const uu = ur * ur + ui * ui, vv = vr * vr + vi * vi;
      re[k] = imUv / 2;
      im[k] = -(uu - vv) / 4;
      if (m !== k) {
        re[m] = imUv / 2;
        im[m] = (uu - vv) / 4;
      }
    }

    for (let k = 0; k < n; k++) im[k] = -im[k];
    this._transform(re, im);

    // Under 1e-13 of the energy is rounding: zero, or silence makes dips
    const d = this._cmnd;
    const e0 = energy[half];
    const floor = energy[size] * 1e-13;
    d[0] = 0;
    for (let tau = 1; tau < half; tau++) {
      const r = re[tau] / n;
      const v = e0 + (energy[tau + half] - energy[tau]) - 2 * r;
      d[tau] = v > floor ? v : 0;
    }
  }

  // In-place radix-2 FFT
  _transform(re, im) {
    const n = this._n, rev = this._reversed;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const cos = this._cos, sin = this._sin;
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = (n / len) | 0;
      for (let i = 0; i < n; i += len) {
        for (let k = 0, t = 0; k < halfLen; k++, t += step) {
          const a = i + k, b = a + halfLen;
          const wr = cos[t], wi = sin[t];
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}
