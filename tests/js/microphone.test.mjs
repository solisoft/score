// The microphone's words and the waveform under the staves (public/eui-score
// mic.js and audio-ui.js), without a browser: what a refusal says, what an
// unusable page says, and where a take's waveform is drawn on the roll.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Mic from "../../public/eui-score/mic.js";
import { waveSvg, WAVE_H } from "../../public/eui-score/audio-ui.js";

test("a refusal says what happened and how to allow it", () => {
  assert.match(Mic.refusal({ name: "NotAllowedError" }), /refused.*Allow it/);
  assert.match(Mic.refusal({ name: "SecurityError" }), /refused/);
  assert.match(Mic.refusal({ name: "NotFoundError" }), /No microphone was found/);
  assert.match(Mic.refusal({ name: "NotReadableError" }), /busy/);
  assert.equal(Mic.refusal({ name: "Other", message: "odd" }), "The microphone could not be opened: odd");
  assert.equal(Mic.refusal(null), "The microphone could not be opened.");
});

test("without a microphone to ask for (an http page), it says so instead of asking", async () => {
  await assert.rejects(Mic.openMic(), /secure page/);
  assert.equal(Mic.inputLatency(null), 0);
  assert.equal(Mic.inputLatency({ getAudioTracks: () => [{ getSettings: () => ({ latency: 0.012 }) }] }), 0.012);
  Mic.closeMic(null);
  let stopped = 0;
  Mic.closeMic({ getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] });
  assert.equal(stopped, 2);
});

test("the waveform: a line per column, as tall as the loudest sample there, placed by the score's time", () => {
  // A roll of 10 px a second from x = 100; the take from the score's 2 s.
  const geo = { x: (tick) => 100 + tick * 10, width: 300, left: 100 };
  const peaks = Float32Array.from([1, 0.5, 0, 0.25]);
  const svg = waveSvg(geo, peaks, { offset: 2, step: 1, tickAt: (sec) => (sec > 4 ? null : sec), label: "Voice <1>" });
  assert.match(svg, new RegExp(`height="${WAVE_H}"`));
  assert.match(svg, /aria-label="Voice &lt;1&gt;: waveform"/);
  const path = svg.match(/ d="([^"]*)"/)[1];
  // 2 s, 3 s and 4 s drawn (5 s is past the score's end), full height at 2 s.
  assert.deepEqual([...path.matchAll(/M(\d+) /g)].map((m) => Number(m[1])), [120, 130, 140]);
  assert.match(path, /^M120 4\.0V52\.0/);
  // Recorded at half speed: a second of sound is half a second of the score.
  const slow = waveSvg(geo, peaks, { offset: 2, takeRate: 0.5, step: 1, tickAt: (sec) => sec });
  assert.deepEqual([...slow.match(/ d="([^"]*)"/)[1].matchAll(/M(\d+) /g)].map((m) => Number(m[1])), [120, 125, 130, 135]);
  assert.match(waveSvg(geo, new Float32Array(0), { offset: 0, tickAt: () => 0, label: "x", recording: true }), /wave-recording/);
});
