// The audio takes (#390), without the browser: their WAV files, their
// rate, their waveform, and the arithmetic that keeps a take in time with
// the score — where its first sample sits in the score's playback when it
// is recorded, and where to start it when the score plays.
//
// The times. The score's playback is in its own seconds (score-model.js
// `playback`, player.js `handle.time`), which run `rate` times as fast as
// the clock when the speed is not 1. A take is laid in those seconds from
// `offset`: its sample at `b` seconds into it is heard with the score's
// second `offset + b × takeRate`, `takeRate` the speed it was recorded at.
//
// No DOM, no Web Audio: tests/js/takes.test.mjs runs it.

/** The rate takes are kept at: enough for a voice and most instruments, half a CD's bytes. */
export const TAKE_RATE = 24000;
/** The audio tracks a score has (SCORE_TAKE_TRACKS on the server). */
export const TRACKS = 4;
/** The size a take may have (SCORE_TAKE_MAX_BYTES on the server). */
export const MAX_BYTES = 8000000;
/** How much of what was heard before the first bar a take keeps: an early breath, an upbeat. */
export const PREROLL = 0.25;

/** The longest take, in seconds of sound, that fits in `maxBytes` as a 16-bit mono WAV at `rate`. */
export function maxSeconds(maxBytes = MAX_BYTES, rate = TAKE_RATE) {
  return Math.floor(((maxBytes - 44) / (2 * rate)) * 10) / 10;
}

/** `samples` (−1…1) as a WAV file's bytes: PCM, 16-bit, mono, at `rate`. */
export function encodeWav(samples, rate = TAKE_RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, word) => [...word].forEach((c, k) => view.setUint8(at + k, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
  }
  return bytes;
}

/**
 * A WAV file's sound, `{ samples, rate }` (the channels mixed to one), for
 * 16-bit PCM; null for anything else (the browser decodes those).
 */
export function decodeWav(bytes) {
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (data.length < 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const word = (at) => String.fromCharCode(...data.subarray(at, at + 4));
  if (word(0) !== "RIFF" || word(8) !== "WAVE") return null;
  let at = 12;
  let format = null;
  while (at + 8 <= data.length) {
    const id = word(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      format = { code: view.getUint16(at + 8, true), channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
    } else if (id === "data") {
      if (!format || format.code !== 1 || format.bits !== 16) return null;
      const frames = Math.floor(Math.min(size, data.length - at - 8) / (2 * format.channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < format.channels; c++) sum += view.getInt16(at + 8 + (i * format.channels + c) * 2, true) / 32768;
        samples[i] = sum / format.channels;
      }
      return { samples, rate: format.rate };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/**
 * `samples` at `from` Hz, at `to` Hz: when it goes down, each output sample
 * the mean of the input it covers (which keeps what is above the new
 * Nyquist out), read between samples linearly.
 */
export function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = from / to;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  const width = Math.max(1, ratio);
  const at = (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = samples[Math.min(samples.length - 1, Math.max(0, i))];
    const b = samples[Math.min(samples.length - 1, Math.max(0, i + 1))];
    return a + (b - a) * f;
  };
  for (let k = 0; k < length; k++) {
    const center = k * ratio;
    if (width <= 1) {
      out[k] = at(center);
      continue;
    }
    // A box as wide as one output sample, read at each input sample in it.
    const steps = Math.ceil(width);
    let sum = 0;
    for (let s = 0; s < steps; s++) sum += at(center - width / 2 + ((s + 0.5) * width) / steps);
    out[k] = sum / steps;
  }
  return out;
}

/** Each `step` seconds of `samples` (at `rate`), its loudest sample: what the waveform draws. */
export function peaks(samples, rate, step = 0.01) {
  const per = Math.max(1, Math.round(rate * step));
  const out = new Float32Array(Math.ceil(samples.length / per));
  for (let k = 0; k < out.length; k++) {
    let peak = 0;
    const end = Math.min(samples.length, (k + 1) * per);
    for (let i = k * per; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
    out[k] = peak;
  }
  return out;
}

/**
 * The score's second heard as a block of the microphone came in: `blockTime`
 * the audio clock's time of that block, read at `ctxNow` while the score
 * was at `handleTime` (player.js `handle.time`) and playing at `rate`. What
 * the microphone gives was played that long before (`inputLatency`), along
 * with music that left the speakers `outputLatency` before it was heard.
 */
export function musicAt({ blockTime, ctxNow, handleTime, rate = 1, inputLatency = 0, outputLatency = 0 }) {
  return handleTime - (ctxNow - blockTime) * rate - (inputLatency + outputLatency) * rate;
}

/** The median of `values`; null with none. */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Where a take's first sample sits, from what was measured while it was
 * recorded: `marks` `[{ sample, music }]` — a block's first sample (counted
 * from the take's start) and the score's second then (`musicAt`). Each
 * mark says where sample 0 is; the median of them, so that a late block or
 * a hiccup of the clock does not move the take.
 */
export function offsetOf(marks, rate, takeRate = 1) {
  return median(marks.map((m) => m.music - (m.sample / rate) * takeRate));
}

/**
 * The part of a recording kept as the take: from `PREROLL` before the
 * score's second `from` (where the recording began) to the end, and the
 * take's offset then. `offset` is where sample 0 sat. Answers `{ start,
 * offset }`, `start` the first sample kept.
 */
export function trimmed(offset, from, rate, takeRate = 1, preroll = PREROLL) {
  const skip = Math.max(0, Math.floor(((from - preroll - offset) / takeRate) * rate));
  return { start: skip, offset: offset + (skip / rate) * takeRate };
}

/**
 * When to start a take as the score plays: the score at its second `music`
 * now, at `rate`; the take laid from `offset`, recorded at `takeRate`,
 * `duration` seconds of sound. `lead` seconds from now it starts:
 * `{ delay, from, playbackRate }` — wait `delay` seconds, then play from
 * `from` seconds into the take — or null when the take is over by then.
 */
export function scheduleOf({ music, rate = 1, offset, takeRate = 1, duration, lead = 0.03 }) {
  const then = music + lead * rate;
  let from = (then - offset) / takeRate;
  let delay = lead;
  if (from < 0) {
    delay += (-from * takeRate) / rate;
    from = 0;
  }
  if (from >= duration) return null;
  return { delay, from, playbackRate: rate / takeRate };
}

/** A take's lane in the mixer, beside the staves' numbers: "audio-1". */
export const laneOf = (track) => `audio-${track}`;

/** A size in words: "1.2 MB", "640 kB". */
export function sizeText(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

/** A length in words: "0:07", "2:46". */
export function lengthText(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
