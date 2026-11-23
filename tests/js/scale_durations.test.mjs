// Durations doubled or halved over a selection (#1024): halved, the notes
// take the first half of the time they held and rests the rest; doubled,
// they write over what follows, tied across the bar lines as a note longer
// than its bar always is, the score made longer when it ends too soon. Each
// note keeps its marks. Refused when a note would be shorter than a 128th,
// or a tuplet is in the way.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as T from "../../public/eui-score/score-tools.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const open = (src) => M.fromParsed(JSON.parse(score_json(src)), src).score;

/** Lane `lane` as "c'4 d'8~ r2": each event's pitch (or r) and value, a tie as ~. */
function written(score, lane = 0) {
  return score.staves[lane].events.map((ev) => {
    const name = ev.rest ? "r" : ev.pitches.map((p) => M.spellPitch(p.d, p.alter)).join("+");
    return `${name}${ev.base}${".".repeat(ev.dots)}${ev.tie ? "~" : ""}`;
  }).join(" ");
}

const all = (score, lane = 0) => [{ s: lane, a: 0, b: score.staves[lane].events.length - 1 }];

test("halved: the notes in the first half of their time, rests after them", () => {
  const score = open(`{ c'4 d'4 e'2 | f'1 }`);
  T.scaleDurations(score, [{ s: 0, a: 0, b: 2 }], 0.5);
  assert.equal(written(score), "c'8 d'8 e'4 r2 f'1");
});

test("doubled: written over what follows, the bars after it untouched", () => {
  const score = open(`{ c'8 d'8 e'4 r2 | f'1 }`);
  T.scaleDurations(score, [{ s: 0, a: 0, b: 2 }], 2);
  assert.equal(written(score), "c'4 d'4 e'2 f'1");
});

test("doubled past the bar line: tied across it; past the end: the score grows", () => {
  const score = open(`{ c'2. d'4 }`);
  T.scaleDurations(score, [{ s: 0, a: 0, b: 0 }], 2);
  assert.equal(written(score), "c'1~ c'2 r2");
  const short = open(`{ c'2 d'2 }`);
  T.scaleDurations(short, all(short), 2);
  assert.equal(written(short), "c'1 d'1");
  assert.equal(M.barsOf(short), 2);
});

test("each note keeps its marks; a tie inside the selection stays, one to a note outside it goes", () => {
  const score = open(`{ c'4\\f-. d'4~ d'4 e'4~ | e'1 }`);
  T.scaleDurations(score, [{ s: 0, a: 0, b: 3 }], 0.5);
  assert.equal(written(score), "c'8 d'8~ d'8 e'8 r2 e'1");
  const first = score.staves[0].events[0];
  assert.equal(first.dynamic, "f");
  assert.deepEqual(first.arts, ["staccato"]);
});

test("halving and doubling again gives back the notes", () => {
  const score = open(`{ c'4 d'8 e'8 f'2 }`);
  T.scaleDurations(score, all(score), 0.5);
  T.scaleDurations(score, [{ s: 0, a: 0, b: 3 }], 2);
  assert.equal(written(score), "c'4 d'8 e'8 f'2");
});

test("over two staves, each halved on its own", () => {
  const score = open(`<< \\new Staff { c''2 d''2 } \\new Staff { \\clef bass c1 } >>`);
  T.scaleDurations(score, T.barRanges(score, [0, 1], 0, 0), 0.5);
  assert.equal(written(score, 0), "c''4 d''4 r2");
  assert.equal(written(score, 1), "c2 r2");
});

test("refused: a note shorter than a 128th, a tuplet selected, a tuplet written over; nothing changed", () => {
  const tiny = open(`{ c'128 d'128 e'64 f'32 g'16 a'8 b'4 c''2 }`);
  const before = written(tiny);
  assert.throws(() => T.scaleDurations(tiny, [{ s: 0, a: 0, b: 1 }], 0.5), /128th/);
  assert.equal(written(tiny), before);
  const triplets = open(`{ \\tuplet 3/2 { c'8 d' e' } f'4 g'2 }`);
  assert.throws(() => T.scaleDurations(triplets, all(triplets), 2), /tuplet/);
  const after = open(`{ c'4 d'4 \\tuplet 3/2 { c'8 d' e' } f'4 }`);
  assert.throws(() => T.scaleDurations(after, [{ s: 0, a: 0, b: 1 }], 2), /tuplet/);
  assert.throws(() => T.scaleDurations(after, [{ s: 0, a: 0, b: 1 }], 3), /double or halve/);
});
