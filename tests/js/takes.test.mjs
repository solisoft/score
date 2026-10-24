// The audio takes without the browser (public/eui-score/takes.js): their WAV
// files, their rate, their waveform, and the arithmetic that lays a take in
// the score's time when it is recorded and starts it in time on Play.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../../public/eui-score/takes.js";

test("a WAV written and read back: 16-bit mono, its header as any player reads it", () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2, 0.25]);
  const bytes = T.encodeWav(samples, 24000);
  assert.equal(bytes.length, 44 + samples.length * 2);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...bytes.subarray(8, 12)), "WAVE");
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(22, true), 1);
  const back = T.decodeWav(bytes);
  assert.equal(back.rate, 24000);
  // Clipped at ±1, within a 16-bit step.
  [0, 0.5, -0.5, 1, -1, 1, -1, 0.25].forEach((x, k) => assert.ok(Math.abs(back.samples[k] - x) < 1 / 16000, `sample ${k}`));
});

test("reads a stereo 16-bit WAV as one channel, and leaves other files to the browser", () => {
  const bytes = new Uint8Array(44 + 8);
  const view = new DataView(bytes.buffer);
  const text = (at, w) => [...w].forEach((c, k) => (bytes[at + k] = c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 44, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 44100, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, 8, true);
  view.setInt16(44, 16384, true);
  view.setInt16(46, 0, true);
  view.setInt16(48, -32768, true);
  view.setInt16(50, -32768, true);
  const back = T.decodeWav(bytes);
  assert.equal(back.rate, 44100);
  assert.deepEqual([...back.samples], [0.25, -1]);
  view.setUint16(34, 24, true);
  assert.equal(T.decodeWav(bytes), null, "24-bit: the browser's");
  assert.equal(T.decodeWav(new TextEncoder().encode("ID3 not a wav")), null);
  assert.equal(T.decodeWav(new Uint8Array(4)), null);
});

test("resampled down from 48 kHz: half as many samples, a low tone kept, a tone above the new Nyquist gone", () => {
  const tone = (freq, rate, seconds) => Float32Array.from({ length: rate * seconds }, (_, i) => Math.sin((2 * Math.PI * freq * i) / rate));
  const low = T.resample(tone(440, 48000, 1), 48000, 24000);
  assert.equal(low.length, 24000);
  const expected = tone(440, 24000, 1);
  let error = 0;
  for (let i = 10; i < 23990; i++) error = Math.max(error, Math.abs(low[i] - expected[i]));
  assert.ok(error < 0.05, `the low tone kept: ${error}`);
  // 23.9 kHz: just under 48 kHz's Nyquist, far over 24 kHz's.
  const high = T.resample(tone(23900, 48000, 1), 48000, 24000);
  assert.ok(Math.max(...high.map(Math.abs)) < 0.05, "the high one averaged away");
  assert.equal(T.resample(expected, 24000, 24000), expected);
  assert.equal(T.resample(tone(100, 16000, 1), 16000, 24000).length, 24000, "up: interpolated");
});

test("the waveform: each hundredth of a second, its loudest sample", () => {
  const samples = new Float32Array(2400);
  samples[10] = -0.8;
  samples[500] = 0.3;
  const p = T.peaks(samples, 24000, 0.01);
  assert.equal(p.length, 10);
  assert.ok(Math.abs(p[0] - 0.8) < 1e-6);
  assert.ok(Math.abs(p[2] - 0.3) < 1e-6);
  assert.equal(p[5], 0);
});

test("recorded: a block of the microphone placed in the score's time, latencies taken off", () => {
  // The score at 10 s now; the block came in 50 ms ago, at speed 1.
  assert.ok(Math.abs(T.musicAt({ blockTime: 4.95, ctxNow: 5, handleTime: 10 }) - 9.95) < 1e-9);
  // At half speed the score moved half as far meanwhile; the latencies count in its seconds too.
  const slow = T.musicAt({ blockTime: 4.9, ctxNow: 5, handleTime: 10, rate: 0.5, inputLatency: 0.02, outputLatency: 0.03 });
  assert.ok(Math.abs(slow - (10 - 0.05 - 0.025)) < 1e-9);
});

test("the take's place is the median of what each block says: one late block does not move it", () => {
  const rate = 24000;
  // Sample 0 sits at the score's 1.5 s; blocks every 128 samples, one of them late by 80 ms.
  const marks = Array.from({ length: 21 }, (_, k) => ({ sample: k * 128, music: 1.5 + (k * 128) / rate + (k === 7 ? 0.08 : 0) }));
  assert.ok(Math.abs(T.offsetOf(marks, rate) - 1.5) < 1e-9);
  // Recorded at half speed: a second of sound is half a second of the score.
  const half = [{ sample: 24000, music: 3 }];
  assert.equal(T.offsetOf(half, rate, 0.5), 2.5);
  assert.equal(T.median([]), null);
  assert.equal(T.median([3, 1, 2, 10]), 2.5);
});

test("trimmed to a little before the bar recording began: the count-in left out", () => {
  // Sample 0 at the score's −2 s (the count-in), recording from the score's 4 s.
  const kept = T.trimmed(-2, 4, 24000);
  assert.equal(kept.start, Math.floor((4 - 0.25 + 2) * 24000));
  assert.ok(Math.abs(kept.offset - 3.75) < 1e-6);
  // Already later than that: nothing cut.
  assert.deepEqual(T.trimmed(5, 4, 24000), { start: 0, offset: 5 });
});

test("played back: where to start a take, now or later, and not once it is over", () => {
  // The score at 12 s, the take from 10 s, 5 s long: from 2.03 s into it, at once.
  const now = T.scheduleOf({ music: 12, offset: 10, duration: 5 });
  assert.ok(Math.abs(now.from - 2.03) < 1e-9);
  assert.equal(now.delay, 0.03);
  assert.equal(now.playbackRate, 1);
  // The take begins 2 s ahead: wait for it.
  const later = T.scheduleOf({ music: 8, offset: 10, duration: 5 });
  assert.equal(later.from, 0);
  assert.ok(Math.abs(later.delay - 2) < 1e-9);
  // At half speed, recorded at speed 1: twice as long to wait, played at half its rate.
  const slow = T.scheduleOf({ music: 8, rate: 0.5, offset: 10, duration: 5 });
  assert.ok(Math.abs(slow.delay - (0.03 + 1.985 * 2)) < 1e-9);
  assert.equal(slow.playbackRate, 0.5);
  // Recorded at half speed: its second covers half a second of the score.
  const recordedSlow = T.scheduleOf({ music: 11, offset: 10, takeRate: 0.5, duration: 5, lead: 0 });
  assert.equal(recordedSlow.from, 2);
  assert.equal(recordedSlow.playbackRate, 2);
  assert.equal(T.scheduleOf({ music: 15.5, offset: 10, duration: 5 }), null);
});

test("the size limit as seconds, the mixer's lane, and sizes and lengths in words", () => {
  assert.equal(T.maxSeconds(), 166.6);
  assert.equal(T.maxSeconds(48044, 24000), 1);
  assert.equal(T.laneOf(2), "audio-2");
  assert.equal(T.sizeText(1234567), "1.2 MB");
  assert.equal(T.sizeText(640000), "640 kB");
  assert.equal(T.lengthText(166.6), "2:47");
  assert.equal(T.lengthText(7), "0:07");
});
