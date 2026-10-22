// Copies the microphone into 1024-frame hops, each posted as a transferred
// buffer stamped with the context frame of its first sample. With more than
// one channel it follows the one with signal: some browsers fill only one
// side, and a downmix would halve the level the gate reads.

class ScalitaCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.hop = o.hop || 1024;
    this.buf = new Float32Array(this.hop);
    this.fill = 0;
    this.start = 0;
    this.next = 0;
    this.ch = 0;
    this.energy = [];
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.alive = false;
    };
  }

  pick(input) {
    let ch = this.ch < input.length ? this.ch : 0;
    for (let c = 0; c < input.length; c++) {
      const x = input[c];
      let s = 0;
      for (let i = 0; i < x.length; i++) s += x[i] * x[i];
      this.energy[c] = (this.energy[c] || 0) * 0.995 + s;
    }
    // Only a clear difference moves it, so two live channels do not flap
    for (let c = 0; c < input.length; c++) {
      if (this.energy[c] > 4 * this.energy[ch] + 1e-12) ch = c;
    }
    this.ch = ch;
    return input[ch];
  }

  process(inputs) {
    if (!this.alive) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const x = input.length > 1 ? this.pick(input) : input[0];
    // A hop never spans a gap in the input
    if (this.fill > 0 && currentFrame !== this.next) this.fill = 0;
    this.next = currentFrame + x.length;
    let i = 0;
    while (i < x.length) {
      if (this.fill === 0) this.start = currentFrame + i;
      const n = Math.min(x.length - i, this.hop - this.fill);
      this.buf.set(x.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.hop) {
        const out = this.buf;
        this.port.postMessage({ frame: this.start, samples: out }, [out.buffer]);
        this.buf = new Float32Array(this.hop);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('scalita-capture', ScalitaCapture);
