// What the engraver learns beside #402 (#401, #403–#405): \partCombine,
// \autoChange, \RemoveEmptyStaves, the \override and \tweak it honours. The
// editor must open such a score and keep these in its text through every
// edit. The pinned engraver does not read \partCombine or \autoChange yet,
// so its answers come from the engraver branches that add them, saved in
// fixtures/engine_401_405.json (score_json, source_spans, and how many items
// editor_view drew): the model reads them as the page will once the
// engraver is updated.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../../public/eui-score/score-model.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/engine_401_405.json", import.meta.url), "utf8"));
const q = M.notated(4);
const A4 = { rest: false, pitches: [{ d: 12, alter: 0 }] };

/** The model of fixture `name`, read as the page reads it. */
function read(name) {
  const { src, parsed } = fixtures[name];
  const result = M.fromParsed(structuredClone(parsed), src, { spans: parsed.spans });
  assert.ok(result.score, `reads: ${result.unsupported}`);
  assert.equal(result.lost, undefined, "nothing is lost");
  return result.score;
}

/**
 * The model's text. Unedited, its items are numbered as the engraver numbered
 * the source's notes and rests (what is kept as written, as it was).
 */
function written(name, score, edited = false) {
  const { source, items } = M.toLilyPond(score);
  const numbered = 1 + Math.max(...fixtures[name].parsed.staves.flatMap((st) => st.events.map((ev) => ev.i)));
  if (!edited) assert.equal(items.length, numbered, `the engraver's numbers\n${source}`);
  assert.ok(items.every((it) => it.kept || score.staves[it.staff]?.events[it.index]), "every item is an event of the model, or kept");
  return source;
}

test("\\partCombine: the staff kept as written with the variables it uses; the other staves edited", () => {
  const score = read("partCombine");
  const source = written("partCombine", score);
  assert.match(source, /^sop = \\relative c'' \{ c4 d e f \| g1 \}\nalt = \\relative c' \{ a4 b c2 \| g'1 \}\n/);
  assert.match(source, /\\new Staff \\with \{ instrumentName = "Oboes" \} \{ \\partCombine \\sop \\alt \}/);
  assert.ok(M.isRaw(score, 0) && !M.isRaw(score, 2));
  // Its two parts are read as two voices, shown and played: the second's notes where they differ.
  assert.equal(score.staves[0].events.filter((ev) => !ev.rest).length, 5);
  assert.equal(score.staves[1].voice, 2);
  assert.deepEqual(score.staves[1].events.filter((ev) => !ev.rest).map((ev) => ev.pitches[0].d), [5, 6, 7]);
  // A note of the other staff written: the kept staff stays as it was.
  const bass = M.staffLanes(score)[1];
  M.write(score, bass, 0, q, A4);
  const after = written("partCombine", score, true);
  assert.match(after, /\\partCombine \\sop \\alt/);
  assert.match(after, /a'4 c2\. \| c1/);
  // Its own notes are edited in the text; so is anything that changes every staff's bars.
  assert.throws(() => M.write(score, 0, 0, q, A4), /kept as LilyPond wrote it/);
  assert.throws(() => M.toggleArticulation(score, 0, 0, "staccato"), /kept as LilyPond wrote it/);
  assert.throws(() => M.insertBars(score, 1, 1), /put bars in or take them away in the text/);
  assert.throws(() => M.deleteBars(score, 0, 0), /in the text/);
  assert.throws(() => M.write(score, bass, M.barStart(score, 2), q, A4), /in the text/);
  assert.throws(() => M.transpose(score, { steps: 1, semitones: 2 }), /in the text/);
  assert.throws(() => M.addVoice(score, 0), /kept as LilyPond wrote it/);
  assert.throws(() => M.setClefAt(score, 0, 1, "bass"), /kept as LilyPond wrote it/);
  // The other staff transposed alone.
  M.transpose(score, { steps: 1, semitones: 2, s: bass });
  assert.match(written("partCombine", score, true), /b'4 d2\./);
});

test("\\partCombine alone on its staff", () => {
  const score = read("partCombineAlone");
  assert.equal(written("partCombineAlone", score).trim(), "\\new Staff \\partCombine \\relative c'' { c2 d | e1 } \\relative c' { a2 b | e1 }");
});

test("\\autoChange: the piano staff kept as written beside a staff edited as any other", () => {
  const score = read("autoChange");
  const source = written("autoChange", score);
  assert.match(source, /\n {2}\\new PianoStaff \\autoChange \\relative c' \{ c4 g a, b' \| <c e,>1 \}\n>>/);
  // Its brace is in its text: not written again around it.
  assert.equal((source.match(/PianoStaff/g) ?? []).length, 1);
  M.write(score, 0, 0, q, A4);
  assert.match(written("autoChange", score, true), /a'4 e''2\. \| f''1/);
  // Alone, the whole score.
  const alone = read("autoChangeAlone");
  assert.equal(written("autoChangeAlone", alone).trim(), "\\new PianoStaff \\autoChange { c'4 g a, b' | c1 }");
});

test("\\RemoveEmptyStaves in \\layout and in \\with, honoured by the engraver: kept", () => {
  const score = read("removeEmpty");
  const source = written("removeEmpty", score);
  assert.match(source, /\\layout \{ \\context \{ \\Staff \\RemoveEmptyStaves \} \}/);
  assert.match(source, /\\new Staff \\with \{ \\RemoveEmptyStaves \}/);
  M.write(score, 1, 0, q, A4);
  assert.match(written("removeEmpty", score, true), /\\RemoveEmptyStaves \}[^]*\\RemoveEmptyStaves/);
});

test("\\override, \\hide, \\tweak, \\omit the engraver honours: kept where they are written", () => {
  const score = read("overrides");
  const source = written("overrides", score);
  assert.match(source, /\\override NoteHead\.style = #'diamond c'4 \\once \\hide Stem d'4 \\tweak color #red e'4 \\omit Accidental fis'4 \| \\revert NoteHead\.style g'1/);
  M.write(score, 0, 0, M.notated(2), A4);
  assert.match(written("overrides", score, true), /\\override NoteHead\.style = #'diamond a'2 \\tweak color #red e'4/);
});
