// Signs moved by hand (#1020) on a transposing part (#1023): a tweak written
// on a note after `\transposition bes` is kept through the text, the model
// as it sounds and the written-pitch view; and in that view the signs drawn
// are found on the model's notes, so the editor drags them there as it does
// at concert pitch.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const parse = (src) => ({ ...JSON.parse(score_json(src)), spans: JSON.parse(source_spans(src)) });
function read(src) {
  const result = M.fromParsed(parse(src), src, { parse });
  assert.ok(result.score, `reads: ${result.unsupported}`);
  assert.deepEqual(result.lost ?? [], [], "nothing lost");
  return result.score;
}
const names = (score) => score.staves[0].events.filter((ev) => !ev.rest).map((ev) => ev.pitches.map((p) => M.pitchName(p.d, p.alter)).join("+"));

const CLARINET = `\\new Staff \\with { instrumentName = "Clarinet" midiInstrument = "clarinet" } {
  \\clef treble \\key d \\major \\time 4/4
  \\transposition bes d'4-\\tweak DynamicText.extra-offset #'(1.5 . -2) \\mf e'4 fis'4 g'4 | a'1 \\bar "|."
}`;

test("a dynamic tweaked on a note after \\transposition survives a round trip", () => {
  const score = read(CLARINET);
  assert.deepEqual(names(score), ["C4", "D4", "E4", "F4", "G4"], "kept as it sounds");
  const ev = score.staves[0].events[0];
  assert.deepEqual(M.signTweak(ev, "dynamic").offset, [1.5, -2]);
  // Written back as it was read: the written notes, the tweak on the first note, before its dynamic.
  assert.equal(M.toLilyPond(score).source.trim(), CLARINET);
  // At written pitch and at concert pitch alike, the tweak stays on its note.
  for (const written of [true, false]) {
    const shown = M.toLilyPond(score, { written }).source;
    assert.match(shown, /-\\tweak DynamicText\.extra-offset #'\(1\.5 \. -2\) \\mf/, `written: ${written}`);
  }
  // Read again, it is the same score.
  const again = read(M.toLilyPond(score).source);
  assert.deepEqual(M.signTweak(again.staves[0].events[0], "dynamic").offset, [1.5, -2]);
  assert.equal(M.toLilyPond(again).source, M.toLilyPond(score).source);
});

test("a tweak set or reset on the model as it sounds keeps the written notes and the \\transposition", () => {
  const score = read(CLARINET);
  M.setSignTweak(score, 0, 0, "dynamic", { offset: [0.5, 1] });
  const text = M.toLilyPond(score).source;
  assert.match(text, /\\transposition bes d'4-\\tweak DynamicText\.extra-offset #'\(0\.5 \. 1\) \\mf e'4 fis'4 g'4 \| a'1/);
  M.resetSign(score, 0, 0, "dynamic");
  assert.match(M.toLilyPond(score).source, /\\transposition bes d'4\\mf e'4 fis'4 g'4 \| a'1/);
  // Undone at written pitch (M.asWritten) as well: the tools run there leave the tweak where it is.
  M.setSignTweak(score, 0, 0, "dynamic", { offset: [1, 0] });
  M.asWritten(score, () => {});
  assert.deepEqual(M.signTweak(score.staves[0].events[0], "dynamic").offset, [1, 0]);
  assert.deepEqual(names(score), ["C4", "D4", "E4", "F4", "G4"]);
});

for (const [what, src] of [
  ["a part with its own \\transposition", CLARINET],
  ["a B♭ clarinet known by its name", `\\new Staff \\with { instrumentName = "Clarinet in B♭" midiInstrument = "clarinet" } {
  \\clef treble \\time 4/4
  c'4-\\tweak DynamicText.extra-offset #'(1.5 . -2) \\mf d'4 e'4 f'4 | g'1 \\bar "|."
}`],
]) {
  test(`at written pitch, ${what}: each sign drawn is on the model's note that has it`, () => {
    const score = read(src);
    const { source, items } = M.toLilyPond(score, { written: true });
    const view = JSON.parse(editor_view(source, 900, 8, -1, -1));
    const sign = view.signs.find((x) => x.on === "dynamic");
    assert.ok(sign, "the engraver draws the dynamic");
    // The studio's noteOf: the drawn item, through the items toLilyPond answered, to the model's event.
    const at = items[sign.item];
    assert.ok(at, "the sign's item is one of the score's");
    const ev = score.staves[at.staff].events[at.index];
    assert.ok(M.hasSign(ev, "dynamic"));
    assert.deepEqual(M.signTweak(ev, "dynamic").offset, [1.5, -2]);
    // Dragged there: written on the model, the written view shows it moved too.
    M.setSignTweak(score, at.staff, at.index, "dynamic", { offset: [2, -2] });
    const moved = JSON.parse(editor_view(M.toLilyPond(score, { written: true }).source, 900, 8, -1, -1));
    const after = moved.signs.find((x) => x.on === "dynamic");
    assert.ok(Math.abs(after.box[0] - sign.box[0] - 4) < 1e-6, `half a space right: ${after.box[0] - sign.box[0]}`);
  });
}
