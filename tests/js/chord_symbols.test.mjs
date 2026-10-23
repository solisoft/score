// Chord symbols beyond the plain triads and sevenths (#372): C7b9, Cm7b5,
// C(add9), C7#11, Cmaj7, C/E, Csus4, Cdim7, C6/9 are read as chord symbols —
// not as words above the note — and move with the score: the root and the
// bass, spelled by the interval, and never the alterations.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** The model of one bar with `text` above its first note. */
function scoreWith(text) {
  const result = M.fromParsed(JSON.parse(score_json(`{ c''4^"${text}" d'' e'' f'' }`)));
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result.score;
}

/** The score moved by an interval, and engraved: its first chord symbol. */
function moved(text, steps, semitones) {
  const score = scoreWith(text);
  M.transpose(score, { steps, semitones });
  const { source } = M.toLilyPond(score);
  JSON.parse(editor_view(source, 900, 7, -1, -1));
  return score.staves[0].events[0].chord;
}

// Each form, then: up a minor second (flats), up an augmented unison
// (sharps), down a major second (flats), down a minor third.
const FORMS = [
  ["C7b9", "Db7b9", "C#7b9", "Bb7b9", "A7b9"],
  ["Cm7b5", "Dbm7b5", "C#m7b5", "Bbm7b5", "Am7b5"],
  ["C(add9)", "Db(add9)", "C#(add9)", "Bb(add9)", "A(add9)"],
  ["C7#11", "Db7#11", "C#7#11", "Bb7#11", "A7#11"],
  ["Cmaj7", "Dbmaj7", "C#maj7", "Bbmaj7", "Amaj7"],
  ["C/E", "Db/F", "C#/E#", "Bb/D", "A/C#"],
  ["Csus4", "Dbsus4", "C#sus4", "Bbsus4", "Asus4"],
  ["Cdim7", "Dbdim7", "C#dim7", "Bbdim7", "Adim7"],
  ["C6/9", "Db6/9", "C#6/9", "Bb6/9", "A6/9"],
  ["C7(b9,#11)/E", "Db7(b9,#11)/F", "C#7(b9,#11)/E#", "Bb7(b9,#11)/D", "A7(b9,#11)/C#"],
  ["F#m(maj7)", "Gm(maj7)", "F##m(maj7)", "Em(maj7)", "D#m(maj7)"],
  ["Bb13/Ab", "Cb13/Bbb", "B13/A", "Ab13/Gb", "G13/F"],
];

for (const [form, upFlat, upSharp, downFlat, downThird] of FORMS) {
  test(`${form} is a chord symbol, and moves root and bass only`, () => {
    const score = scoreWith(form);
    const first = score.staves[0].events[0];
    assert.equal(first.chord, form, "read as the chord symbol");
    assert.equal(first.texts.length, 0, "not left as a word above the note");
    assert.ok(M.isChordSymbol(form));
    assert.equal(moved(form, 1, 1), upFlat, "up a minor second");
    assert.equal(moved(form, 0, 1), upSharp, "up an augmented unison");
    assert.equal(moved(form, -1, -2), downFlat, "down a major second");
    assert.equal(moved(form, -2, -3), downThird, "down a minor third");
  });
}

test("there and back again: the same chord symbol", () => {
  for (const [form] of FORMS) {
    assert.equal(M.transposeChord(M.transposeChord(form, 2, 4), -2, -4), form);
  }
});

test("a word above a note is not taken for a chord symbol", () => {
  for (const word of ["Do", "Bad", "Each", "dolce", "Ab-solutely", "C7b", "C(add)", "H7", "Cmaj7/", "C/H", "A tempo"]) {
    assert.equal(M.isChordSymbol(word), false, word);
  }
  const score = scoreWith("Bad");
  assert.equal(score.staves[0].events[0].chord, "");
  assert.deepEqual(score.staves[0].events[0].texts.map((w) => w.text), ["Bad"]);
});

test("the plain symbols still read", () => {
  for (const plain of ["C", "Am", "F#m7/C#", "Bbmaj9", "E♭m7", "G7sus4", "Cø7", "C°7", "C+", "C-7", "Cadd9", "C7alt", "C9", "C13"]) {
    assert.ok(M.isChordSymbol(plain), plain);
  }
});
