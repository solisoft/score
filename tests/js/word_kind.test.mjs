// What a word drawn on the score is to the editor (#434): the box a double
// click on it opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../../public/eui-score/score-model.js";

const text = (words, italic = false) => ({ kind: "text", index: 0, words: { text: words, italic, bold: false, glyph: null } });

test("a chord diagram, a chord symbol, an expression and a staff text", () => {
  const ev = { chord: "Am7" };
  assert.equal(M.wordKind(text("\u0001fret:x;3;2;o;1;o;"), ev), "fret");
  assert.equal(M.wordKind(text("Am7"), ev), "chord");
  assert.equal(M.wordKind(text("dolce", true), ev), "expression");
  assert.equal(M.wordKind(text("solo"), ev), "text");
  // The same words, with no chord symbol on the note: a staff text.
  assert.equal(M.wordKind(text("Am7"), {}), "text");
});

test("a syllable is a lyric, whatever its words", () => {
  assert.equal(M.wordKind({ kind: "lyric", index: 1, words: null }, {}), "lyric");
});

test("a sign drawn as words, or no words at all, opens nothing", () => {
  assert.equal(M.wordKind({ kind: "text", index: 0, words: { text: "", italic: false, bold: false, glyph: "keyboardPedalPed" } }, {}), null);
  assert.equal(M.wordKind({ kind: "text", index: 0, words: null }, {}), null);
  assert.equal(M.wordKind(text("   "), {}), null);
});
