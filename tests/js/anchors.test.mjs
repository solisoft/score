// Comment threads follow their bars (#392): where a save's old bars and
// lanes went in its new text (public/eui-score/merge.js, anchorMap), which
// the server moves the threads by (ScoreThread.follow).
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import { anchorMap, barsByOps, runsOf, mergeScores } from "../../public/eui-score/merge.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

function canon(text) {
  const { score } = M.fromParsed(JSON.parse(score_json(text)));
  assert.ok(score, `reads: ${text}`);
  score.meta = null;
  return M.toLilyPond(score).source;
}

const melody = (bars) => canon(`\\new Staff { \\time 4/4 ${bars.join(" | ")} }`);
const two = (upper, lower) => canon(`<< \\new Staff \\with { instrumentName = "Flute" } { \\time 4/4 ${upper.join(" | ")} } \\new Staff \\with { instrumentName = "Cello" } { \\clef bass ${lower.join(" | ")} } >>`);
const three = (upper, middle, lower) =>
  canon(`<< \\new Staff \\with { instrumentName = "Flute" } { \\time 4/4 ${upper.join(" | ")} } \\new Staff \\with { instrumentName = "Oboe" } { ${middle.join(" | ")} } \\new Staff \\with { instrumentName = "Cello" } { \\clef bass ${lower.join(" | ")} } >>`);
const map = (base, next, ops) => anchorMap(base, next, { parse: score_json, ops });

/** Where old bar `b` went, as the server reads the runs (null: taken away). */
const whereIs = (moved, b) => {
  const run = moved.bars.find(([from, , length]) => b >= from && b < from + length);
  return run ? run[1] + b - run[0] : null;
};

const BARS = ["c'1", "d'1", "e'1", "f'1", "g'1"];

test("nothing moved: no map to send, whether notes changed or not", () => {
  const base = melody(BARS);
  assert.equal(map(base, base), null);
  assert.equal(map(base, melody(["c'1", "d'2 d'2", "e'1", "f'1", "g'1"])), null);
  assert.equal(map(null, base), null);
});

test("a bar put in: the bars after it move one on; those before stay", () => {
  const base = melody(BARS);
  const moved = map(base, melody(["c'1", "d'1", "a'1", "e'1", "f'1", "g'1"]));
  assert.equal(moved.from, 5);
  assert.equal(moved.to, 6);
  assert.deepEqual([0, 1, 2, 3, 4].map((b) => whereIs(moved, b)), [0, 1, 3, 4, 5]);
  assert.deepEqual(moved.lanes, [0]);
});

test("bars taken away: those gone are in no run, the later ones move back", () => {
  const moved = map(melody(BARS), melody(["c'1", "f'1", "g'1"]));
  assert.deepEqual([0, 1, 2, 3, 4].map((b) => whereIs(moved, b)), [0, null, null, 1, 2]);
});

test("bars that read the same: the editor's own operations say which one was put in", () => {
  const same = ["r1", "r1", "r1", "r1"];
  const base = melody(same);
  const next = melody([...same, "r1"]);
  // By content alone, an empty bar put in reads as one added at the end.
  const byContent = map(base, next);
  assert.deepEqual([0, 1, 2, 3].map((b) => whereIs(byContent, b)), [0, 1, 2, 3]);
  const byOps = map(base, next, [{ at: 1, removed: 0, added: 1 }]);
  assert.deepEqual([0, 1, 2, 3].map((b) => whereIs(byOps, b)), [0, 2, 3, 4]);
  // Operations that do not account for the new count (an Undo since, say) are not believed.
  const wrong = map(base, next, [{ at: 1, removed: 0, added: 2 }]);
  assert.equal(whereIs(wrong, 1), 1);
});

test("a staff added above: every lane under it moves down, bars stay", () => {
  const up = ["c''1", "d''1"];
  const low = ["c1", "d1"];
  const moved = map(two(up, low), three(up, ["e'1", "f'1"], low));
  assert.deepEqual(moved.lanes, [0, 2]);
  assert.equal(moved.from, 2);
  assert.equal(moved.to, 2);
});

test("a staff taken away: its lane is gone (−1), the others follow", () => {
  const up = ["c''1", "d''1"];
  const low = ["c1", "d1"];
  const moved = map(three(up, ["e'1", "f'1"], low), two(up, low));
  assert.deepEqual(moved.lanes, [0, -1, 1]);
});

test("a staff added while another is changed in the same save: the changed one keeps its lane", () => {
  const up = ["c''1", "d''1"];
  const low = ["c1", "d1"];
  const moved = map(two(up, low), three(up, ["e'1", "f'1"], ["g1", "d1"]));
  assert.deepEqual(moved.lanes, [0, 2]);
});

test("a merge of someone else's bar put in with my note changed: the map from theirs to the merge has nothing to move", () => {
  const base = melody(BARS);
  const theirs = melody(["c'1", "a'1", ...BARS.slice(1)]);
  const mine = melody(["c'2 c'2", ...BARS.slice(1)]);
  const merged = mergeScores(base, mine, theirs, { parse: score_json }).text;
  assert.ok(merged);
  // Their editor sent base → theirs; mine sends theirs → merged.
  assert.deepEqual([0, 1, 2].map((b) => whereIs(map(base, theirs), b)), [0, 2, 3]);
  assert.equal(map(theirs, merged), null);
});

test("an Undo of a bar put in: the bars after it move back", () => {
  const before = melody(BARS);
  const after = melody(["c'1", "a'1", ...BARS.slice(1)]);
  const undone = map(after, before);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((b) => whereIs(undone, b)), [0, null, 1, 2, 3, 4]);
});

test("operations replayed, and runs written compactly", () => {
  assert.deepEqual(barsByOps(4, [{ at: 1, removed: 0, added: 2 }, { at: 0, removed: 1, added: 0 }]), [null, null, 1, 2, 3]);
  assert.equal(barsByOps(4, []), null);
  assert.equal(barsByOps(4, null), null);
  assert.equal(barsByOps(4, [{ at: 9, removed: 0, added: 1 }]), null);
  assert.deepEqual(runsOf([[0, 0], [1, 1], [3, 2], [4, 3], [5, 5]]), [[0, 0, 2], [3, 2, 2], [5, 5, 1]]);
});

test("a text the model cannot read: no map", () => {
  assert.equal(map(melody(BARS), "not lilypond at all {{{"), null);
});
