// A selection over several staves (#1024): bars dragged or Shift+clicked
// across staves select every voice of each; Delete, transposing, the arrows,
// articulations and dynamics act on each staff's notes in those bars; drum
// staves and lines of chord names are passed over, and a selection with no
// note to act on is refused.
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

// Three staves; the second has two voices: lanes 0, 1 (voice 1), 2 (voice 2), 3.
const TRIO = `<<
  \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''1 | a''1 }
  \\new Staff { << { e'4 f' g' a' | b'1 | c''1 } \\\\ { c'2 c' | d'1 | e'1 } >> }
  \\new Staff { \\clef bass c4 d e f | g1 | a1 }
>>`;

const notes = (score, lane, bar) => {
  const staff = score.staves[lane];
  const at = M.starts(staff);
  const [from, to] = [M.barStart(score, bar), M.barStart(score, bar + 1)];
  return staff.events.filter((ev, i) => at[i] >= from && at[i] < to && !ev.rest).map((ev) => M.pitchName(ev.pitches[0].d, ev.pitches[0].alter));
};

test("the lanes between two staves: every voice of each, top to bottom, whichever was clicked first", () => {
  const score = open(TRIO);
  assert.equal(score.staves.length, 4);
  assert.deepEqual(T.lanesBetween(score, 0, 3), [0, 1, 2, 3]);
  assert.deepEqual(T.lanesBetween(score, 3, 0), [0, 1, 2, 3]);
  // A voice of the middle staff stands for the whole staff.
  assert.deepEqual(T.lanesBetween(score, 2, 3), [1, 2, 3]);
  assert.deepEqual(T.lanesBetween(score, 0, 2), [0, 1, 2]);
  assert.deepEqual(T.lanesBetween(score, 1, 1), [1, 2]);
});

test("each lane's events in the selected bars: first and last index, per lane", () => {
  const score = open(TRIO);
  const ranges = T.barRanges(score, [0, 1, 2, 3], 0, 0);
  assert.deepEqual(ranges.map((r) => [r.s, r.a, r.b]), [[0, 0, 3], [1, 0, 3], [2, 0, 1], [3, 0, 3]]);
  const second = T.barRanges(score, [0, 3], 1, 2);
  assert.deepEqual(second.map((r) => [r.s, r.a, r.b]), [[0, 4, 5], [3, 4, 5]]);
  // Bars past the end: no lane has events there.
  assert.deepEqual(T.barRanges(score, [0, 3], 9, 9), []);
});

test("Delete over several staves makes rests of every note in the bars, the other bars kept", () => {
  const score = open(TRIO);
  T.clearRanges(score, T.barRanges(score, [0, 1, 2, 3], 0, 0));
  for (const lane of [0, 1, 2, 3]) assert.deepEqual(notes(score, lane, 0), [], `lane ${lane}`);
  assert.deepEqual(notes(score, 0, 1), ["G5"]);
  assert.deepEqual(notes(score, 3, 2), ["A3"]);
  assert.equal(M.barsOf(score), 3);
});

test("transposing a selection over several staves moves each staff's notes, the keys left alone", () => {
  const score = open(TRIO);
  T.transposeRanges(score, T.barRanges(score, [0, 1, 2, 3], 1, 1), { steps: 1, semitones: 2 });
  assert.deepEqual(notes(score, 0, 1), ["A5"]);
  assert.deepEqual(notes(score, 1, 1), ["C♯5"]);
  assert.deepEqual(notes(score, 2, 1), ["E4"]);
  assert.deepEqual(notes(score, 3, 1), ["A3"]);
  // Bar 1 is as it was.
  assert.deepEqual(notes(score, 0, 0), ["C5", "D5", "E5", "F5"]);
  assert.equal(score.key, 0);
});

test("a drum staff in the selection is passed over; drums alone are refused", () => {
  const score = open(`<< \\new Staff { c''1 } \\new DrumStaff \\drummode { bd4 sn bd sn } >>`);
  assert.ok(M.isDrums(score, 1));
  T.transposeRanges(score, T.barRanges(score, [0, 1], 0, 0), { steps: 1, semitones: 2 });
  assert.deepEqual(notes(score, 0, 0), ["D5"]);
  assert.throws(() => T.transposeRanges(score, T.barRanges(score, [1], 0, 0), { steps: 1, semitones: 2 }), /drum/i);
});

test("the arrows move every staff's notes a step, Ctrl an octave", () => {
  const score = open(TRIO);
  const ranges = T.barRanges(score, [0, 3], 2, 2);
  T.moveRanges(score, ranges, "step", 1);
  assert.deepEqual(notes(score, 0, 2), ["B5"]);
  assert.deepEqual(notes(score, 3, 2), ["B3"]);
  T.moveRanges(score, T.barRanges(score, [0, 3], 2, 2), "octave", -1);
  assert.deepEqual(notes(score, 0, 2), ["B4"]);
  assert.deepEqual(notes(score, 3, 2), ["B2"]);
});

test("an articulation goes on every note of every staff, again takes it away; rests get none", () => {
  const score = open(`<< \\new Staff { c''4 r d'' e'' } \\new Staff { \\clef bass c2 e } >>`);
  const ranges = () => T.barRanges(score, [0, 1], 0, 0);
  T.toggleArticulationRanges(score, ranges(), "staccato");
  const marked = (lane) => score.staves[lane].events.map((ev) => (ev.rest ? "r" : ev.arts.join(",")));
  assert.deepEqual(marked(0), ["staccato", "r", "staccato", "staccato"]);
  assert.deepEqual(marked(1), ["staccato", "staccato"]);
  T.toggleArticulationRanges(score, ranges(), "staccato");
  assert.deepEqual(marked(0), ["", "r", "", ""]);
});

test("a dynamic goes on the first note of each staff; a selection of rests is refused", () => {
  const score = open(`<< \\new Staff { r4 c''4 d''2 } \\new Staff { \\clef bass c1 } >>`);
  T.dynamicOnRanges(score, T.barRanges(score, [0, 1], 0, 0), "mf");
  assert.deepEqual(score.staves[0].events.map((ev) => ev.dynamic), [null, "mf", null]);
  assert.deepEqual(score.staves[1].events.map((ev) => ev.dynamic), ["mf"]);
  const rests = open(`<< \\new Staff { r1 } \\new Staff { r1 } >>`);
  assert.throws(() => T.dynamicOnRanges(rests, T.barRanges(rests, [0, 1], 0, 0), "p"), /note/i);
  assert.throws(() => T.toggleArticulationRanges(rests, T.barRanges(rests, [0, 1], 0, 0), "accent"), /note/i);
});
