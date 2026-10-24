// The pitch detector and the note segmentation (public/eui-score/pitch.js),
// on made signals: a sine, a sawtooth rich in harmonics, a voice's vibrato,
// silence and noise; then melodies, repeated notes, a slide, short clicks.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Pi from "../../public/eui-score/pitch.js";

const RATE = 24000;

/** `seconds` of a signal: `wave(phase)` (phase in turns), its frequency `freq(t)`, at `gain`. */
function signal(seconds, freq, wave, gain = 0.5, rate = RATE) {
  const out = new Float32Array(Math.round(seconds * rate));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = gain * wave(phase % 1);
    phase += (typeof freq === "function" ? freq(i / rate) : freq) / rate;
  }
  return out;
}

const sine = (p) => Math.sin(2 * Math.PI * p);
const saw = (p) => 2 * p - 1;
// A seeded noise, the same each run.
function noise(length, gain = 0.3, seed = 7) {
  let a = seed;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    a = (a * 1103515245 + 12345) % 2147483648;
    out[i] = gain * ((a / 2147483648) * 2 - 1);
  }
  return out;
}

function join(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const silence = (seconds) => new Float32Array(Math.round(seconds * RATE));
const frame = (samples) => samples.subarray(0, Pi.FRAME);
const cents = (found, expected) => 1200 * Math.log2(found / expected);

test("finds a sine's frequency within a few cents, low and high", () => {
  for (const freq of [82.41, 196, 440, 987.77, 1567.98]) {
    const found = Pi.yin(frame(signal(0.2, freq, sine)), RATE);
    assert.ok(found, `${freq} Hz found`);
    assert.ok(Math.abs(cents(found.freq, freq)) < 5, `${freq} Hz: ${found.freq}`);
    assert.ok(found.clarity > 0.9, "a pure tone is clear");
  }
});

test("a sawtooth's fundamental, not one of its strong harmonics", () => {
  for (const freq of [110, 261.63, 523.25]) {
    const found = Pi.yin(frame(signal(0.2, freq, saw)), RATE);
    assert.ok(Math.abs(cents(found.freq, freq)) < 8, `${freq} Hz: ${found.freq}`);
  }
});

test("a fundamental weaker than its second harmonic is still the fundamental", () => {
  const tone = signal(0.2, 220, (p) => 0.3 * sine(p) + 0.7 * sine(2 * p));
  assert.ok(Math.abs(cents(Pi.yin(frame(tone), RATE).freq, 220)) < 8);
});

test("silence and noise have no pitch, and silence is under the gate", () => {
  assert.equal(Pi.yin(frame(silence(0.2)), RATE), null);
  assert.equal(Pi.yin(noise(Pi.FRAME), RATE), null);
  assert.ok(Pi.rms(silence(0.1)) < Pi.GATE);
  assert.deepEqual(Pi.analyse(silence(0.5), RATE).filter((f) => f.freq != null), []);
  // Noise may give a stray frame its pitch, never a note.
  assert.deepEqual(Pi.segmentNotes(Pi.analyse(noise(RATE), RATE)), []);
});

test("notes, octaves and cents, as a tuner says them, against an A4 of 440 or another", () => {
  assert.deepEqual(Pi.noteOf(440), { key: 69, name: "A", octave: 4, cents: 0 });
  assert.deepEqual(Pi.noteOf(261.63), { key: 60, name: "C", octave: 4, cents: 0 });
  assert.deepEqual(Pi.noteOf(445), { key: 69, name: "A", octave: 4, cents: 20 });
  assert.equal(Pi.noteOf(452).cents, 47);
  assert.deepEqual(Pi.noteOf(466.16), { key: 70, name: "A♯", octave: 4, cents: 0 });
  assert.deepEqual(Pi.noteOf(27.5), { key: 21, name: "A", octave: 0, cents: 0 });
  // Tuned to A4 = 415 (baroque): 415 Hz is A in tune.
  assert.equal(Pi.noteOf(415, 415).cents, 0);
  assert.equal(Pi.noteOf(415).cents, -101 + 100);
  assert.equal(Math.round(Pi.freqOf(60)), 262);
  assert.equal(Pi.freqOf(69, 442), 442);
});

test("a melody of sines becomes its notes, in time", () => {
  const keys = [60, 62, 64, 65, 67];
  const melody = join(...keys.map((k) => signal(0.4, Pi.freqOf(k), sine)));
  const notes = Pi.segmentNotes(Pi.analyse(melody, RATE));
  assert.deepEqual(notes.map((n) => n.key), keys);
  notes.forEach((n, k) => {
    assert.ok(Math.abs(n.t0 - k * 0.4) < 0.06, `note ${k} starts at ${n.t0}`);
    assert.ok(Math.abs(n.t1 - (k + 1) * 0.4) < 0.08, `note ${k} ends at ${n.t1}`);
  });
});

test("a sawtooth melody across octaves", () => {
  const keys = [45, 57, 52, 69, 64];
  const notes = Pi.segmentNotes(Pi.analyse(join(...keys.map((k) => signal(0.3, Pi.freqOf(k), saw, 0.4))), RATE));
  assert.deepEqual(notes.map((n) => n.key), keys);
});

test("vibrato of a third of a tone either way is one note, its pitch the centre", () => {
  const center = Pi.freqOf(67);
  const sung = signal(1.2, (t) => center * 2 ** ((0.33 * Math.sin(2 * Math.PI * 5.5 * t)) / 12), sine);
  const notes = Pi.segmentNotes(Pi.analyse(sung, RATE));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].key, 67);
  assert.ok(Math.abs(notes[0].pitch - 67) < 0.1);
});

test("the same note played twice, with a breath between, is two notes", () => {
  const tone = () => signal(0.35, Pi.freqOf(64), sine);
  const notes = Pi.segmentNotes(Pi.analyse(join(tone(), silence(0.12), tone()), RATE));
  assert.deepEqual(notes.map((n) => n.key), [64, 64]);
  assert.ok(notes[1].t0 > 0.44 && notes[1].t0 < 0.55);
});

test("struck again without a silence (a plucked string decaying, plucked again) is two notes", () => {
  const pluck = () => {
    const tone = signal(0.5, Pi.freqOf(57), saw, 0.6);
    for (let i = 0; i < tone.length; i++) tone[i] *= Math.exp((-6 * i) / RATE);
    return tone;
  };
  const notes = Pi.segmentNotes(Pi.analyse(join(pluck(), pluck()), RATE));
  assert.deepEqual(notes.map((n) => n.key), [57, 57]);
});

test("a click, a breath, a passing slide are no notes", () => {
  const blip = signal(0.03, 880, sine);
  const slide = signal(0.06, (t) => 300 + 4000 * t, sine);
  const notes = Pi.segmentNotes(Pi.analyse(join(silence(0.2), blip, silence(0.2), signal(0.4, Pi.freqOf(60), sine), slide, signal(0.4, Pi.freqOf(65), sine)), RATE));
  assert.deepEqual(notes.map((n) => n.key), [60, 65]);
});

test("the tracker tells a note as soon as it has lasted, then when it is over", () => {
  const tracker = Pi.noteTracker();
  const frames = Pi.analyse(join(signal(0.3, Pi.freqOf(72), sine), silence(0.3)), RATE);
  const said = [];
  for (const f of frames) {
    const out = tracker.push(f);
    if (out.started) said.push(["started", out.started.key, f.t]);
    if (out.ended) said.push(["ended", out.ended.key]);
  }
  assert.equal(said.length, 2);
  assert.equal(said[0][0], "started");
  assert.equal(said[0][1], 72);
  assert.ok(said[0][2] < 0.2, "heard early, not at its end");
  assert.deepEqual(said[1], ["ended", 72]);
  assert.deepEqual(tracker.finish(), {});
});

test("transcribe: keys, times and velocities to write, louder louder", () => {
  const take = join(silence(0.2), signal(0.5, Pi.freqOf(62), sine, 0.05), signal(0.5, Pi.freqOf(69), sine, 0.6));
  const played = Pi.transcribe(take, RATE);
  assert.deepEqual(played.map((n) => n.key), [62, 69]);
  assert.ok(Math.abs(played[0].t0 - 0.2) < 0.06);
  assert.ok(played[1].velocity > played[0].velocity);
  assert.ok(played.every((n) => n.velocity >= 1 && n.velocity <= 127));
  assert.equal(Pi.velocityOf(0), 1);
  assert.equal(Pi.velocityOf(1), 127);
});

test("at 48 kHz too", () => {
  const notes = Pi.transcribe(join(...[55, 60].map((k) => signal(0.4, Pi.freqOf(k), saw, 0.4, 48000))), 48000);
  assert.deepEqual(notes.map((n) => n.key), [55, 60]);
});
