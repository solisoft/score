// The pitch of a single voice or instrument, heard by the microphone (#390):
// the tuner, the transcription of a take and the score following all read
// it from here.
//
// The detector is YIN (de Cheveigné and Kawahara, 2002): the difference of
// a frame with itself shifted by each lag, normalised by its running mean;
// the first lag whose difference dips under a threshold is the period,
// refined between samples by a parabola. It finds the fundamental of a
// sawtooth as surely as a sine's, and says how sure it is (`clarity`, 1
// for a pure tone, near 0 for noise).
//
// The notes: `noteTracker` reads the frames one after the other (live, or
// over a recorded take) and makes notes of them — a new note where the
// pitch moves by a semitone or more and stays there, where the sound stops,
// or where it is struck again; vibrato within a semitone is one note.
//
// No DOM, no Web Audio: tests/js/pitch.test.mjs runs it on made signals.

/** The notes' names, sharps: what a tuner says. */
export const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** The analysis' frame and hop, in samples at any rate: about 43 ms and 11 ms at 48 kHz. */
export const FRAME = 2048;
export const HOP = 512;

/** How sure a frame must be of its pitch to be voiced (YIN's 1 − d′). */
export const CLARITY = 0.75;
/** How loud a frame must be to be heard at all, as RMS (−50 dBFS). */
export const GATE = 0.0032;

/** The loudness of `frame`, as RMS (0–1). */
export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

/**
 * The pitch of `frame` (a Float32Array of samples at `sampleRate`), between
 * `minFreq` and `maxFreq` Hz: `{ freq, clarity }`, or null when no period
 * stands out (silence, noise).
 */
export function yin(frame, sampleRate, { threshold = 0.15, minFreq = 50, maxFreq = 2000 } = {}) {
  const half = Math.floor(frame.length / 2);
  const maxLag = Math.min(half - 1, Math.floor(sampleRate / minFreq));
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  if (maxLag <= minLag) return null;
  const d = new Float32Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const delta = frame[i] - frame[i + lag];
      sum += delta * delta;
    }
    d[lag] = sum;
  }
  // Each lag's difference over the mean of those before it.
  const cmnd = new Float32Array(maxLag + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    running += d[lag];
    cmnd[lag] = running > 0 ? (d[lag] * lag) / running : 1;
  }
  let tau = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (cmnd[lag] < threshold) {
      // Down to the bottom of this dip.
      while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) lag++;
      tau = lag;
      break;
    }
  }
  if (tau < 0) {
    // None under the threshold: the deepest dip, if it is deep enough to mean something.
    let best = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) if (cmnd[lag] < cmnd[best]) best = lag;
    if (cmnd[best] >= 0.5) return null;
    tau = best;
  }
  // Between samples: the parabola through the dip and its neighbours.
  const [a, b, c] = [cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]];
  const bend = a + c - 2 * b;
  const shift = bend > 0 ? (a - c) / (2 * bend) : 0;
  const period = tau + Math.max(-0.5, Math.min(0.5, shift));
  return { freq: sampleRate / period, clarity: Math.max(0, Math.min(1, 1 - b)) };
}

/** `freq` (Hz) as a MIDI key, with its fraction: 69 is A4 at `a4` Hz. */
export function midiOf(freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4);
}

/** The frequency of MIDI key `key` with A4 at `a4` Hz. */
export function freqOf(key, a4 = 440) {
  return a4 * 2 ** ((key - 69) / 12);
}

/**
 * What a tuner says of `freq`: the nearest note, `{ key, name, octave,
 * cents }` — `cents` from −50 to +50, how far it is above (+) or below.
 */
export function noteOf(freq, a4 = 440) {
  const exact = midiOf(freq, a4);
  const key = Math.round(exact);
  return { key, name: NOTE_NAMES[((key % 12) + 12) % 12], octave: Math.floor(key / 12) - 1, cents: Math.round((exact - key) * 100) || 0 };
}

/**
 * The frames of `samples` (at `sampleRate`), one every `hop` samples:
 * `[{ t, freq, clarity, rms }]`, `t` the frame's middle in seconds, `freq`
 * null where none was found.
 */
export function analyse(samples, sampleRate, { frame = FRAME, hop = HOP, minFreq = 50, maxFreq = 2000 } = {}) {
  const out = [];
  for (let at = 0; at + frame <= samples.length; at += hop) {
    const slice = samples.subarray(at, at + frame);
    const loud = rms(slice);
    const found = loud >= GATE ? yin(slice, sampleRate, { minFreq, maxFreq }) : null;
    out.push({ t: (at + frame / 2) / sampleRate, freq: found?.freq ?? null, clarity: found?.clarity ?? 0, rms: loud });
  }
  return out;
}

const median = (values) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};

/**
 * Makes notes of frames, one at a time. `push(frame)` takes a frame of
 * `analyse` (or of the live listener) and answers what it settled:
 * `{ started }` when a note has lasted long enough to be one (live
 * following hears it then), `{ ended }` when one is over — `{ t0, t1, key,
 * pitch, peak }`, `t0`/`t1` in the frames' seconds, `key` the nearest MIDI
 * key, `pitch` the exact median, `peak` its loudest RMS. `finish()` ends
 * the last.
 *
 * - `minNote` (s): shorter is not a note (a slide, a breath, a click).
 * - `gap` (s): an unvoiced stretch shorter than this inside a note is
 *   bridged (a consonant, a frame the detector missed).
 * - `jump` (semitones): a pitch this far from the note's, held `minNote / 2`,
 *   starts the next note. Vibrato and drift stay under it.
 * - `attack`: a note struck again — loudness up `attack` times from its dip
 *   within the last frames — starts a new note of the same pitch.
 */
export function noteTracker({ a4 = 440, minNote = 0.08, gap = 0.05, jump = 0.75, attack = 2.5, clarity = CLARITY } = {}) {
  let note = null; // { t0, last, pitches: [], peak, pending: [], quiet, low }
  let started = false;

  const voiced = (f) => f.freq != null && f.clarity >= clarity && f.rms >= GATE;

  function close(out) {
    if (!note) return;
    const pitch = median(note.pitches);
    if (note.last - note.t0 >= minNote - 1e-9 && note.pitches.length) {
      out.ended = { t0: note.t0, t1: note.last, key: Math.round(pitch), pitch, peak: note.peak };
    }
    note = null;
    started = false;
  }

  function open(f, m, out) {
    note = { t0: f.t, last: f.t, pitches: [m], peak: f.rms, pending: [], quiet: null, low: f.rms };
    settle(out);
  }

  function settle(out) {
    if (!started && note && note.last - note.t0 >= minNote - 1e-9) {
      started = true;
      const pitch = median(note.pitches);
      out.started = { t0: note.t0, key: Math.round(pitch), pitch };
    }
  }

  function push(f) {
    const out = {};
    if (!voiced(f)) {
      if (note) {
        note.quiet ??= f.t;
        note.low = Math.min(note.low, f.rms);
        if (f.t - note.quiet > gap) close(out);
      }
      return out;
    }
    const m = midiOf(f.freq, a4);
    if (!note) {
      open(f, m, out);
      return out;
    }
    const center = median(note.pitches);
    if (Math.abs(m - center) >= jump) {
      // Away from the note: a new one once it has held there.
      note.pending.push({ f, m });
      const pitches = note.pending.map((p) => p.m);
      if (!note.pending.every((p) => Math.abs(p.m - median(pitches)) < jump)) note.pending = note.pending.slice(-1);
      const held = f.t - note.pending[0].f.t;
      if (held >= minNote / 2 - 1e-9) {
        const pending = note.pending;
        note.last = note.quiet ?? pending[0].f.t;
        close(out);
        note = { t0: pending[0].f.t, last: f.t, pitches: pending.map((p) => p.m), peak: Math.max(...pending.map((p) => p.f.rms)), pending: [], quiet: null, low: f.rms };
        settle(out);
      }
      return out;
    }
    note.pending = [];
    // Struck again: the sound back up from a dip — after a short silence, or a fresh attack.
    if (f.rms > attack * note.low && note.low < 0.5 * note.peak && f.t - note.t0 >= minNote - 1e-9) {
      note.last = note.quiet ?? f.t;
      close(out);
      const next = {};
      open(f, m, next);
      if (next.started) out.started = next.started;
      return out;
    }
    note.quiet = null;
    note.pitches.push(m);
    note.last = f.t;
    note.peak = Math.max(note.peak, f.rms);
    // The dip a new attack is measured from: the quietest of the last moments.
    note.low = Math.min(f.rms, note.low * 1.15);
    settle(out);
    return out;
  }

  return {
    push,
    finish() {
      const out = {};
      close(out);
      return out;
    },
  };
}

/**
 * The notes of `frames` (analyse's), in order: `[{ t0, t1, key, pitch,
 * peak }]`. Options as `noteTracker`'s.
 */
export function segmentNotes(frames, options = {}) {
  const tracker = noteTracker(options);
  const notes = [];
  for (const f of frames) {
    const out = tracker.push(f);
    if (out.ended) notes.push(out.ended);
  }
  const last = tracker.finish();
  if (last.ended) notes.push(last.ended);
  return notes;
}

/** A note's loudness as a MIDI velocity (1–127): −50 dBFS soft, −6 dBFS hard. */
export function velocityOf(peak) {
  const db = peak > 0 ? 20 * Math.log10(peak) : -100;
  return Math.max(1, Math.min(127, Math.round(((db + 50) / 44) * 110 + 17)));
}

/**
 * The notes of a take (`samples` at `sampleRate`), as `writeRecording`
 * (score-model.js) takes the keys played: `[{ key, t0, t1, velocity }]`
 * with `t0`/`t1` in the take's seconds.
 */
export function transcribe(samples, sampleRate, options = {}) {
  return segmentNotes(analyse(samples, sampleRate, options), options).map((n) => ({ key: n.key, t0: n.t0, t1: n.t1, velocity: velocityOf(n.peak) }));
}
