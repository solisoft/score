// Recording from a MIDI keyboard (writeRecording, quantize, tickAtPlayed in
// score-model.js): keys played live, fitted to a grid and written as notes
// the real engraver takes.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json, editor_view } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
const Q = M.WHOLE / 4;
const engraves = (score) => assert.doesNotThrow(() => editor_view(M.toLilyPond(score).source, 900, 7, -1, -1));
const music = (score) => M.toLilyPond(score).source.split("\n").find((line) => line.includes("|")).trim();

test("keys a little early or late land on the grid; a quick tap lasts a step", () => {
  const notes = M.quantize([{ key: 60, t0: 300, t1: Q - 500 }, { key: 62, t0: Q + 900, t1: Q + 1200 }], M.RECORDING_GRIDS.sixteenth);
  assert.deepEqual(notes, [{ key: 60, t0: 0, t1: Q }, { key: 62, t0: Q, t1: Q + M.WHOLE / 16 }]);
});

test("a played line is written as notes and rests, from the bar it started in", () => {
  const score = read("{ \\time 4/4 g'1 | g'1 | g'1 }");
  const played = [
    { key: 60, t0: 40, t1: Q - 60 },
    { key: 62, t0: Q + 30, t1: 2 * Q },
    { key: 64, t0: 2 * Q - 20, t1: 4 * Q + 2 * Q },
  ];
  const n = M.writeRecording(score, 0, M.barStart(score, 0), M.barStart(score, 2), played, M.RECORDING_GRIDS.eighth);
  assert.equal(n, 3);
  assert.equal(music(score), "c'4 d'4 e'2~ | e'2 r2 | g'1 \\bar \"|.\"");
  engraves(score);
});

test("keys held together are a chord; one let go while the other holds is tied over", () => {
  const score = read("{ \\time 4/4 r1 }");
  const played = [
    { key: 60, t0: 0, t1: 4 * Q },
    { key: 64, t0: 0, t1: 2 * Q },
    { key: 67, t0: 2 * Q, t1: 4 * Q },
  ];
  M.writeRecording(score, 0, 0, M.barStart(score, 1), played, M.RECORDING_GRIDS.quarter);
  assert.equal(music(score), "<c' e'>2~ <c' g'>2 \\bar \"|.\"");
  engraves(score);
});

test("a key struck again is a new note, not one held on", () => {
  const score = read("{ \\time 4/4 r1 }");
  M.writeRecording(score, 0, 0, M.WHOLE, [{ key: 67, t0: 0, t1: 2 * Q }, { key: 67, t0: 2 * Q, t1: 4 * Q }], M.RECORDING_GRIDS.sixteenth);
  assert.equal(music(score), "g'2 g'2 \\bar \"|.\"");
});

test("a recording past the end makes the bars it needs; nothing played leaves rests", () => {
  const score = read("{ \\time 4/4 c'1 }");
  M.writeRecording(score, 0, M.WHOLE, 2 * M.WHOLE, [{ key: 72, t0: M.WHOLE, t1: M.WHOLE + Q }], M.RECORDING_GRIDS.quarter);
  assert.equal(M.barsOf(score), 2);
  assert.equal(music(score), "c'1 | c''4 r2. \\bar \"|.\"");
  const silent = read("{ \\time 4/4 c'1 | d'1 }");
  assert.equal(M.writeRecording(silent, 0, M.WHOLE, 2 * M.WHOLE, [], M.RECORDING_GRIDS.quarter), 0);
  assert.equal(music(silent), "c'1 | r1 \\bar \"|.\"");
  assert.equal(M.writeRecording(silent, 0, M.WHOLE, M.WHOLE, [], M.RECORDING_GRIDS.quarter), 0, "no bars, nothing written");
});

test("notes are spelled in the key", () => {
  const score = read("{ \\key f \\major \\time 4/4 r1 }");
  M.writeRecording(score, 0, 0, M.WHOLE, [{ key: 70, t0: 0, t1: M.WHOLE }], M.RECORDING_GRIDS.quarter);
  assert.match(music(score), /^bes'1/);
});

test("on a drum staff, each key is its drum; keys no drum answers to are left out", () => {
  const drums = read("\\new DrumStaff \\drummode { \\time 4/4 r1 }");
  const played = [
    { key: 36, t0: 0, t1: Q / 2 },
    { key: 42, t0: 0, t1: Q / 2 },
    { key: 38, t0: Q, t1: Q + Q / 2 },
    { key: 21, t0: 2 * Q, t1: 3 * Q },
  ];
  assert.equal(M.writeRecording(drums, 0, 0, M.WHOLE, played, M.RECORDING_GRIDS.eighth), 3, "the A0 is no drum");
  const hits = drums.staves[0].events.filter((ev) => !ev.rest).map((ev) => ev.pitches.map((p) => p.drum).sort().join("+"));
  assert.deepEqual(hits, ["bd+hh", "sn"]);
  assert.ok(drums.staves[0].events.every((ev) => !ev.tie), "drums are not tied");
  engraves(drums);
  // While it is recorded, the kit plays on past the end too.
  assert.equal(M.forRecording(drums, 0).staves[0].events.filter((ev) => !ev.rest)[2].pitches[0].drum, "bd");
});

test("a triplet grid writes as triplets the beats played off the beat, and the others plain", () => {
  const score = read("{ \\time 4/4 r1 }");
  const T = Q / 3;
  const played = [
    { key: 60, t0: 0, t1: Q },
    { key: 62, t0: Q + 50, t1: Q + T },
    { key: 64, t0: Q + T, t1: Q + 2 * T - 40 },
    { key: 65, t0: Q + 2 * T, t1: 2 * Q },
    { key: 67, t0: 2 * Q, t1: 4 * Q },
  ];
  M.writeRecording(score, 0, 0, M.WHOLE, played, M.RECORDING_GRIDS["eighth-triplet"]);
  assert.equal(music(score), "c'4 \\tuplet 3/2 { d'8 e'8 f'8 } g'2 \\bar \"|.\"");
  engraves(score);
  // A note held over a triplet's edge is tied into it.
  const held = read("{ \\time 4/4 r1 }");
  M.writeRecording(held, 0, 0, M.WHOLE, [{ key: 60, t0: 0, t1: Q + T }, { key: 62, t0: Q + T, t1: 2 * Q }], M.RECORDING_GRIDS["eighth-triplet"]);
  assert.match(music(held), /^c'4~ \\tuplet 3\/2 \{ c'8 d'4 \}|^c'4~ \\tuplet 3\/2 \{ c'8 d'8~ d'8 \}/);
  engraves(held);
  assert.deepEqual(Object.keys(M.RECORDING_GRIDS), ["quarter", "eighth", "eighth-triplet", "sixteenth", "sixteenth-triplet", "thirty-second"]);
});

test("how hard the keys are struck is marked as dynamics where it changes and holds", () => {
  const score = read("{ \\time 4/4 r1 | r1 }");
  const velocities = [40, 42, 100, 70, 72, 74, 110, 112];
  const played = velocities.map((velocity, k) => ({ key: 60 + k, t0: k * Q, t1: (k + 1) * Q, velocity }));
  const plain = structuredClone(score);
  M.writeRecording(score, 0, 0, 2 * M.WHOLE, played, M.RECORDING_GRIDS.quarter, { dynamics: true });
  const marks = score.staves[0].events.map((ev) => ev.dynamic).filter(Boolean);
  // p from the start; the lone f is passed over; mf, then ff.
  assert.deepEqual(marks, ["p", "mf", "ff"]);
  M.writeRecording(plain, 0, 0, 2 * M.WHOLE, played, M.RECORDING_GRIDS.quarter);
  assert.equal(plain.staves[0].events.filter((ev) => ev.dynamic).length, 0, "none without the option");
  engraves(score);
  assert.equal(M.dynamicOfVelocity(10), "pp");
  assert.equal(M.dynamicOfVelocity(127), "ff");
});

test("the time played is the bar of the pass then sounding: a repeat gives its bars again", () => {
  const score = read("{ \\time 4/4 \\tempo 4 = 120 \\repeat volta 2 { c'1 } d'1 }");
  const passes = M.playback(score);
  assert.deepEqual(passes.map((p) => p.bar), [0, 0, 1]);
  // At 120 a quarter, a bar is 2 s.
  assert.equal(M.tickAtPlayed(score, passes, 1), M.WHOLE / 2);
  assert.equal(M.tickAtPlayed(score, passes, 3), M.WHOLE / 2, "the second time through bar 1");
  assert.equal(M.tickAtPlayed(score, passes, 5), M.WHOLE + M.WHOLE / 2);
  assert.equal(M.tickAtPlayed(score, passes, 99), 2 * M.WHOLE, "past the end: the end");
  assert.equal(M.tickAtPlayed(score, [], 1), 0);
});

test("while recording, the score plays on past its end, an empty one too", () => {
  const empty = read("{ \\time 4/4 r1 | r1 }");
  const played = M.forRecording(empty, 0);
  assert.equal(M.barsOf(played), 2 + M.RECORDING_MORE_BARS);
  assert.equal(M.barsOf(empty), 2, "the score itself unchanged");
  const notes = played.staves[0].events.filter((ev) => !ev.rest);
  assert.equal(notes.length, 1, "one note, at the very end");
  const at = M.starts(played.staves[0]);
  const i = played.staves[0].events.findIndex((ev) => !ev.rest);
  assert.equal(at[i] + M.ticksOf(played.staves[0].events[i]), M.barStart(played, M.barsOf(played)));
  assert.ok(M.playback(played).at(-1).end > M.playback(empty).at(-1).end);
  engraves(played);
});
