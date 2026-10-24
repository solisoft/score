// The microphone's sound, block by block, to the page (#390): an
// AudioWorklet processor that gathers the input into blocks of 4096
// samples (the first channel) and posts each with the audio clock's time
// of its first sample. mic.js loads it; it plays nothing.
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.block = new Float32Array(this.size);
    this.filled = 0;
    this.time = 0;
    this.on = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.on = false;
    };
  }

  process(inputs) {
    if (!this.on) return false;
    const input = inputs[0]?.[0];
    if (input) {
      if (this.filled === 0) this.time = currentTime;
      let at = 0;
      while (at < input.length) {
        const n = Math.min(input.length - at, this.size - this.filled);
        this.block.set(input.subarray(at, at + n), this.filled);
        this.filled += n;
        at += n;
        if (this.filled === this.size) {
          this.port.postMessage({ samples: this.block, time: this.time }, [this.block.buffer]);
          this.block = new Float32Array(this.size);
          this.filled = 0;
          this.time = currentTime + at / sampleRate;
        }
      }
    }
    return true;
  }
}

registerProcessor("eui-mic-capture", MicCapture);
