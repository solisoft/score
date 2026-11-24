// A rectangle drawn round notes on the score (#1038): the notes and rests
// whose heads are in it are selected — from the middle of a bar to the middle
// of another, on every staff it crosses — and the tools, copy and paste act
// on exactly them. Notes that fill their bars whole are those bars.
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

const DUO = `<<
  \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''4 a'' b'' c''' }
  \\new Staff { e'4 f' g' a' | b'4 c'' d'' e'' }
>>`;

const names = (score, lane, a, b) => score.staves[lane].events.slice(a, b + 1).map((ev) => (ev.rest ? "r" : M.pitchName(ev.pitches[0].d, ev.pitches[0].alter)));

/**
 * A drawing of DUO as the engraver lays it out, in its coordinates: each
 * event 10 wide, 20 apart (bar 2 after a gap); the top staff's heads at
 * y 100, the lower's at y 200. Answers { drawn, items }.
 */
function drawing(score) {
  const drawn = [];
  const items = [];
  score.staves.forEach((staff, s) => {
    staff.events.forEach((ev, i) => {
      const x = 20 + i * 20 + (i >= 4 ? 20 : 0);
      const y = 100 + s * 100;
      const item = items.length;
      items.push({ staff: s, index: i });
      const head = [x, y - 4, x + 10, y + 4];
      drawn.push({ item, box: [x, y - 30, x + 10, y + 4], heads: ev.rest ? [] : [{ index: 0, box: head }] });
    });
  });
  // An item that is no event (a word drawn on its own) is passed over.
  drawn.push({ item: 99, box: [0, 0, 500, 500], heads: [] });
  return { drawn, items };
}

test("the heads in a rectangle on one staff: from the middle of a bar to the middle of the next", () => {
  const score = open(DUO);
  const { drawn, items } = drawing(score);
  const q = M.barStart(score, 1) / 4;
  // Over e'' f'' | g'' a'' of the top staff, from right to left and bottom to top: either corner first.
  const caught = T.caughtIn(score, [155, 110, 55, 90], drawn, items);
  assert.deepEqual(caught, { lanes: [0], t0: 2 * q, t1: 5 * q });
  const [r] = T.spanRanges(score, caught.lanes, caught.t0, caught.t1);
  assert.deepEqual(names(score, 0, r.a, r.b), ["E5", "F5", "G5", "A5"]);
  // Not whole bars: a span, not bars.
  assert.equal(T.wholeBars(score, caught.lanes, caught.t0, caught.t1), null);
});

test("a head half out of the rectangle is not in it: its middle decides", () => {
  const score = open(DUO);
  const { drawn, items } = drawing(score);
  // e'' is drawn from x 60 to 70: a rectangle to x 64 leaves it out.
  assert.equal(T.caughtIn(score, [52, 90, 64, 110], drawn, items), null);
  assert.deepEqual(T.caughtIn(score, [52, 90, 66, 110], drawn, items).lanes, [0]);
  // Nothing under it: null.
  assert.equal(T.caughtIn(score, [0, 0, 10, 10], drawn, items), null);
});

test("over two staves: both lanes, the same span on each; Delete clears exactly those notes", () => {
  const score = open(DUO);
  const { drawn, items } = drawing(score);
  const caught = T.caughtIn(score, [55, 90, 135, 210], drawn, items);
  const q = M.barStart(score, 1) / 4;
  assert.deepEqual(caught, { lanes: [0, 1], t0: 2 * q, t1: 4 * q });
  const ranges = T.spanRanges(score, caught.lanes, caught.t0, caught.t1);
  assert.deepEqual(ranges, [{ s: 0, a: 2, b: 4 }, { s: 1, a: 2, b: 4 }]);
  T.clearRanges(score, ranges);
  assert.deepEqual(names(score, 0, 0, 7).filter((n) => n !== "r"), ["C5", "D5", "A5", "B5", "C6"]);
  assert.deepEqual(names(score, 1, 0, 7).filter((n) => n !== "r"), ["E4", "F4", "C5", "D5", "E5"]);
});

test("a rest's glyph is caught as a head is", () => {
  const score = open(`{ \\time 4/4 c''4 r4 e''4 f''4 }`);
  const { drawn, items } = drawing(score);
  // The rest's box (x 40–50) has its middle at y 87: a rectangle round it.
  const caught = T.caughtIn(score, [35, 80, 52, 95], drawn, items);
  const q = M.barStart(score, 1) / 4;
  assert.deepEqual(caught, { lanes: [0], t0: q, t1: q });
});

test("notes that fill their bars whole are those bars, on one staff or several", () => {
  const score = open(DUO);
  const end = M.barStart(score, 1);
  const q = end / 4;
  assert.deepEqual(T.wholeBars(score, [0], 0, 3 * q), [0, 0]);
  assert.deepEqual(T.wholeBars(score, [0, 1], 0, 7 * q), [0, 1]);
  // One note short of the bar's end, or from its second beat: not whole.
  assert.equal(T.wholeBars(score, [0], 0, 2 * q), null);
  assert.equal(T.wholeBars(score, [0], q, 3 * q), null);
});

test("notes of two staves from the middle of a bar copied, and pasted elsewhere as far apart as they were", () => {
  const score = open(DUO);
  const q = M.barStart(score, 1) / 4;
  // e'' f'' g'' over the top staff, the lower staff from f' (a beat earlier) to b'.
  const section = M.copySpan(score, [1, 0], 1 * q, 4 * q);
  assert.equal(section.span, true);
  assert.equal(section.bars, 2);
  assert.deepEqual(section.parts.map((part) => [part.offset, part.at, part.pieces.length]), [[0, 0, 4], [1, 0, 4]]);
  // Pasted from bar 2's second beat: each staff's notes there, what follows them as it was.
  const pasted = structuredClone(score);
  assert.equal(M.pasteSectionAt(pasted, 0, 5 * q, section), 0);
  const top = pasted.staves[0].events.map((ev) => (ev.rest ? "r" : M.pitchName(ev.pitches[0].d, ev.pitches[0].alter)));
  assert.deepEqual(top.slice(0, 5), ["C5", "D5", "E5", "F5", "G5"]);
  assert.deepEqual(top.slice(5, 9), ["D5", "E5", "F5", "G5"]);
  const low = pasted.staves[1].events.map((ev) => (ev.rest ? "r" : M.pitchName(ev.pitches[0].d, ev.pitches[0].alter)));
  assert.deepEqual(low.slice(5, 9), ["F4", "G4", "A4", "B4"]);
});

test("a part that begins later than the span keeps its distance when pasted", () => {
  const score = open(`<<
  \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''1 }
  \\new Staff { e'2 g'2 | b'1 }
>>`);
  const q = M.barStart(score, 1) / 4;
  // From the top staff's d'' (beat 2): the lower staff's first note in the span is g' (beat 3).
  const section = M.copySpan(score, [0, 1], q, 2 * q);
  assert.deepEqual(section.parts.map((part) => part.at), [0, q]);
  const pasted = structuredClone(score);
  M.pasteSectionAt(pasted, 0, 4 * q, section);
  const at = M.starts(pasted.staves[1]);
  const i = at.indexOf(5 * q);
  assert.ok(i >= 0, "the lower staff's note a beat after the paste's start");
  assert.equal(M.pitchName(pasted.staves[1].events[i].pitches[0].d, 0), "G4");
  // Bars, as before: a section from the bar's start, its parts at 0.
  assert.equal(M.copySection(score, [0, 1], 0, 0).parts.every((part) => part.at == null), true);
});

test("paste special of a span: the rhythm on the pitches there, from the selection's time", () => {
  const score = open(DUO);
  const q = M.barStart(score, 1) / 4;
  const section = M.copySpan(score, [0, 1], 2 * q, 3 * q);
  const pasted = structuredClone(score);
  assert.equal(T.pasteSpecial(pasted, 0, 5 * q, { section }, "notes"), 0);
  assert.deepEqual(names(pasted, 0, 5, 6), ["E5", "F5"]);
  assert.deepEqual(names(pasted, 1, 5, 6), ["G4", "A4"]);
});
