// The note palette's side (#416): over the note unless chord symbols stand
// there — the staff's own (Ctrl+K) or a line of chord names above it — so it
// never hides them (M.chordsOver).
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const read = (src) => M.fromParsed(JSON.parse(score_json(src)), src).score;

test("a staff with no chord symbol keeps the palette over the note", () => {
  const score = read("\\relative c'' { c4 d e f }");
  assert.equal(M.chordsOver(score, 0), false);
});

test("a chord symbol on the staff puts the palette under the note, on every lane of it", () => {
  const score = read("\\relative c'' { c4 d e f | g1 }");
  M.setChordSymbol(score, 0, 2, "Am7");
  assert.equal(score.staves[0].events[2].chord, "Am7");
  assert.equal(M.chordsOver(score, 0), true);
  const piano = read("\\new PianoStaff << \\new Staff \\relative c'' { << { c4 d e f } \\\\ { a,2 b } >> } \\new Staff { \\clef bass c1 } >>");
  const second = piano.staves.findIndex((staff, k) => M.isLower(piano, k));
  M.setChordSymbol(piano, second, 0, "F");
  assert.equal(M.chordsOver(piano, 0), true, "a chord on the second voice is over the staff too");
  assert.equal(M.chordsOver(piano, M.staffLanes(piano).at(-1)), false, "the lower staff has none");
});

test("a line of chord names over the staff does too; the line itself and the staff under none do not", () => {
  const score = read("<< \\relative c'' { c4 d e f } \\new Staff { \\clef bass c1 } >>");
  const line = M.addChordStaff(score, 0);
  assert.equal(score.staves[line].chords, true);
  const melody = M.staffLanes(score)[1];
  assert.equal(M.chordsOver(score, melody), true);
  assert.equal(M.chordsOver(score, line), false, "the chord line's own notes are the chords");
  assert.equal(M.chordsOver(score, M.staffLanes(score)[2]), false);
});
