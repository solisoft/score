// Transposing to a key, or in the key by degrees (#1024): to a key, the
// interval from the key the music is in to the one asked for — up, down or
// the nearest way, an octave more or less — the key signatures and the
// chord symbols following as they do for an interval; in the key, each note
// moved by letters as the key spells them, a note the key does not hold
// keeping its sharp or flat apart from it. A selection moves alone, its key
// signature left as it is.
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

const names = (score, lane = 0) => score.staves[lane].events.filter((ev) => !ev.rest).map((ev) => ev.pitches.map((p) => M.pitchName(p.d, p.alter)).join("+"));
const chords = (score, lane = 0) => score.staves[lane].events.filter((ev) => ev.chord).map((ev) => ev.chord);

test("the interval from one key to another: up, down, or the nearest way", () => {
  // C to D.
  assert.deepEqual(T.keyInterval(0, 2, 1), { steps: 1, semitones: 2 });
  assert.deepEqual(T.keyInterval(0, 2, -1), { steps: -6, semitones: -10 });
  assert.deepEqual(T.keyInterval(0, 2, 0), { steps: 1, semitones: 2 });
  // C to B: the nearest is down a semitone.
  assert.deepEqual(T.keyInterval(0, 5, 0), { steps: -1, semitones: -1 });
  assert.deepEqual(T.keyInterval(0, 5, 1), { steps: 6, semitones: 11 });
  // C to F♯ and to G♭: a tritone, up when it is as near either way.
  assert.deepEqual(T.keyInterval(0, 6, 0), { steps: 3, semitones: 6 });
  assert.deepEqual(T.keyInterval(0, -6, 0), { steps: 4, semitones: 6 });
  // C♭ to B: the same sound, spelled again — no move at all the nearest way.
  assert.deepEqual(T.keyInterval(-7, 5, 0), { steps: -1, semitones: 0 });
  assert.deepEqual(T.keyInterval(-7, 5, 1), { steps: 6, semitones: 12 });
  // C to C♭: down a semitone, the same letter; up, a diminished octave.
  assert.deepEqual(T.keyInterval(0, -7, 0), { steps: 0, semitones: -1 });
  assert.deepEqual(T.keyInterval(0, -7, 1), { steps: 7, semitones: 11 });
  // C to C♯.
  assert.deepEqual(T.keyInterval(0, 7, 1), { steps: 0, semitones: 1 });
  // The same key: nowhere, up an octave, down an octave.
  assert.deepEqual(T.keyInterval(3, 3, 0), { steps: 0, semitones: 0 });
  assert.deepEqual(T.keyInterval(3, 3, 1), { steps: 7, semitones: 12 });
  assert.deepEqual(T.keyInterval(3, 3, -1), { steps: -7, semitones: -12 });
});

test("the score to D major, the nearest way: its notes, its key and its chord symbols", () => {
  const score = open(`{ \\key c \\major c'4^"C" e' g'^"G7" c'' }`);
  T.transposeToKey(score, 2);
  assert.deepEqual(names(score), ["D4", "F♯4", "A4", "D5"]);
  assert.equal(score.key, 2);
  assert.deepEqual(chords(score), ["D", "A7"]);
  assert.match(M.toLilyPond(score).source, /\\key d \\major/);
});

test("to a key seven sharps or flats away, and down, and an octave more", () => {
  const sharp = open(`{ c'4 e' g' c'' }`);
  T.transposeToKey(sharp, 7, { way: 1 });
  assert.equal(sharp.key, 7);
  assert.deepEqual(names(sharp), ["C♯4", "E♯4", "G♯4", "C♯5"]);
  const flat = open(`{ \\key g \\major g'4 b' d'' fis'' }`);
  T.transposeToKey(flat, -7, { way: -1 });
  assert.equal(flat.key, -7);
  assert.deepEqual(names(flat), ["C♭4", "E♭4", "G♭4", "B♭4"]);
  const high = open(`{ c'4 e' g' c'' }`);
  T.transposeToKey(high, 1, { way: 1, octave: 1 });
  assert.deepEqual(names(high), ["G5", "B5", "D6", "G6"]);
  assert.equal(high.key, 1);
});

test("a staff written in a key of its own (a horn) moves as far as the score's", () => {
  const score = open(`<< \\new Staff { \\key c \\major c''1 } \\new Staff { \\key g \\major g'1 } >>`);
  assert.equal(score.staves[1].key, 1);
  T.transposeToKey(score, -1);
  assert.equal(score.key, -1);
  assert.equal(score.staves[1].key, 0);
  // G up a fourth, as the score's C to F.
  assert.deepEqual(names(score, 1), ["C5"]);
});

test("a selection to a key: its notes move from the key they are in, the key signature stays", () => {
  const score = open(`{ \\key c \\major c'4 d' e' f' | c'4 d' e' f' }`);
  const ranges = T.barRanges(score, [0], 1, 1);
  T.transposeToKey(score, 4, { ranges });
  assert.deepEqual(names(score), ["C4", "D4", "E4", "F4", "E4", "F♯4", "G♯4", "A4"]);
  assert.equal(score.key, 0);
});

test("in the key, by degrees: up a step stays in C major; down a third; in G, F♯ is the key's", () => {
  const score = open(`{ c'4 d' e' f' | g'1 }`);
  T.transposeDiatonic(score, 1);
  assert.deepEqual(names(score), ["D4", "E4", "F4", "G4", "A4"]);
  T.transposeDiatonic(score, -2);
  assert.deepEqual(names(score), ["B3", "C4", "D4", "E4", "F4"]);
  assert.equal(score.key, 0);
  const inG = open(`{ \\key g \\major e'4 fis' g' a' }`);
  T.transposeDiatonic(inG, 1);
  assert.deepEqual(names(inG), ["F♯4", "G4", "A4", "B4"]);
});

test("in the key, a note the key does not hold keeps its sharp apart from it; chords and their symbols move", () => {
  const score = open(`{ cis'4^"A7" <c' e' g'>4^"C" r2 }`);
  T.transposeDiatonic(score, 1);
  assert.deepEqual(names(score), ["D♯4", "D4+F4+A4"]);
  assert.deepEqual(chords(score), ["B7", "D"]);
});

test("in the key, a selection over two staves moves alone; the bars outside stay", () => {
  const score = open(`<< \\new Staff { c''1 | c''1 } \\new Staff { \\clef bass c1 | c1 } >>`);
  T.transposeDiatonic(score, 4, { ranges: T.barRanges(score, [0, 1], 1, 1) });
  assert.deepEqual(names(score, 0), ["C5", "G5"]);
  assert.deepEqual(names(score, 1), ["C3", "G3"]);
});

test("refused: no degrees, a key past seven sharps, a selection of drums alone", () => {
  const score = open(`{ c'1 }`);
  assert.throws(() => T.transposeDiatonic(score, 0), /degree/);
  assert.throws(() => T.transposeToKey(score, 8), /key/);
  const drums = open(`\\new DrumStaff \\drummode { bd4 sn bd sn }`);
  assert.throws(() => T.transposeDiatonic(drums, 1, { ranges: T.barRanges(drums, [0], 0, 0) }), /[Dd]rums/);
});
