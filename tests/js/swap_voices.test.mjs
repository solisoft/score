// Voices 1 and 2 swapped over the selected bars (#417): crossed voices put
// back, the high notes in voice 1; the other bars untouched; refused on a
// staff of one voice.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const open = (src) => M.fromParsed(JSON.parse(score_json(src)), src).score;

// Bar 2's voices written crossed: voice 1 low (f f c' c'), voice 2 high (f' f' d' f').
const CROSSED = "{ \\time 4/4 d'1 | << { f4 f c' c' } \\\\ { f'4 f' d' f' } >> | e'1 }";

/** The steps of the notes lane `lane` sounds in bar `bar` (rests left out). */
function notesIn(score, lane, bar) {
  const staff = score.staves[lane];
  const at = M.starts(staff);
  const [from, to] = [M.barStart(score, bar), M.barStart(score, bar + 1)];
  return staff.events.filter((ev, i) => at[i] >= from && at[i] < to && !ev.rest).map((ev) => ev.pitches[0].d);
}

test("the voices of a bar change places: the high notes go to voice 1, the low to voice 2", () => {
  const score = open(CROSSED);
  const one = M.laneOfVoice(score, 0, 1);
  const two = M.laneOfVoice(score, 0, 2);
  const low = notesIn(score, one, 1);
  const high = notesIn(score, two, 1);
  assert.equal(low.length, 4);
  assert.ok(Math.max(...low) < Math.min(...high), "crossed before");
  M.swapVoices(score, 0, 1, 1);
  assert.deepEqual(notesIn(score, one, 1), high);
  assert.deepEqual(notesIn(score, two, 1), low);
});

test("bars outside the selection keep their voices, and the bar count is the same", () => {
  const score = open(CROSSED);
  const one = M.laneOfVoice(score, 0, 1);
  const bars = M.barsOf(score);
  const [first, last] = [notesIn(score, one, 0), notesIn(score, one, 2)];
  M.swapVoices(score, 0, 1, 1);
  assert.equal(M.barsOf(score), bars);
  assert.deepEqual(notesIn(score, one, 0), first);
  assert.deepEqual(notesIn(score, one, 2), last);
});

test("swapping twice gives back the score as it was", () => {
  const score = open(CROSSED);
  const shape = () => JSON.stringify(score.staves.map((staff) => staff.events.map((ev) => [ev.rest, ev.pitches?.map((p) => p.d), M.ticksOf(ev)])));
  const before = shape();
  M.swapVoices(score, 0, 1, 1);
  assert.notEqual(shape(), before);
  M.swapVoices(score, 0, 1, 1);
  assert.equal(shape(), before);
});

test("refused on a staff of one voice, and nothing changes", () => {
  const single = open("{ c'4 d' e' f' | g'1 }");
  const before = JSON.stringify(single.staves);
  assert.throws(() => M.swapVoices(single, 0, 0, 0), /one voice/);
  assert.equal(JSON.stringify(single.staves), before);
});
