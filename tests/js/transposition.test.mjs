// A staff's own \transposition (#1023): `\transposition bes` says that from
// there on its notes are written as a B♭ instrument reads them, and the
// engraver plays them a tone lower. The editor keeps them as they sound, the
// text keeps them written: read, edited and written back, nothing moves; the
// written pitch, the parts and the review read the transposition from it,
// before guessing it from the instrument's name.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as R from "../../public/eui-score/review.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const parse = (src) => ({ ...JSON.parse(score_json(src)), spans: JSON.parse(source_spans(src)) });
function read(src) {
  const result = M.fromParsed(parse(src), src, { parse });
  assert.ok(result.score, `reads: ${result.unsupported}`);
  assert.equal(result.lost, undefined, "nothing lost");
  return result.score;
}
const names = (score, lane = 0) => score.staves[lane].events.filter((ev) => !ev.rest).map((ev) => ev.pitches.map((p) => M.pitchName(p.d, p.alter)).join("+"));
/** The keys a text plays, in order. */
const played = (src) => {
  const smf = F.readSmf(midi(src, 100, 4, 0));
  return smf.tracks.flat().filter((ev) => (ev.data[0] & 0xf0) === 0x90 && ev.data[2] > 0).sort((a, b) => a.tick - b.tick).map((ev) => ev.data[1]);
};
const q = M.notated(4);

const CLARINET = `\\new Staff \\with { instrumentName = "Clarinet" midiInstrument = "clarinet" } {
  \\clef treble \\key d \\major \\time 4/4
  \\transposition bes d'4 e'4 fis'4 g'4 | a'1 \\bar "|."
}`;

test("a part written with \\transposition bes: kept as it sounds, its text written as it was", () => {
  const score = read(CLARINET);
  assert.deepEqual(names(score), ["C4", "D4", "E4", "F4", "G4"]);
  assert.equal(M.keyOf(score, 0, 0), 0, "C major, as it sounds");
  assert.equal(M.toLilyPond(score).source.trim(), CLARINET);
  assert.equal(M.transpositionOf(score.staves[0]), "d");
  // The engraver plays the text as it sounds; the score the editor shows, as it sounds too.
  assert.deepEqual(played(CLARINET), [60, 62, 64, 65, 67]);
  const concert = M.toLilyPond(score, { written: false }).source;
  assert.match(concert, /\\key c \\major[^]*c'4 d'4 e'4 f'4 \| g'1/);
  // At written pitch: the text's own notes, with no \transpose around them.
  const written = M.toLilyPond(score, { written: true }).source;
  assert.doesNotMatch(written, /\\transpose c/);
  assert.match(written, /\\key d \\major[^]*d'4 e'4 fis'4 g'4 \| a'1/);
});

test("edited as it sounds, the text keeps its \\transposition and its written notes", () => {
  const score = read(CLARINET);
  // A concert A4 written in the second bar: written B4.
  M.write(score, 0, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 12, alter: 0 }] });
  const text = M.toLilyPond(score).source;
  assert.match(text, /\\transposition bes d'4 e'4 fis'4 g'4 \| b'4 a'2\./);
  assert.deepEqual(played(text), [60, 62, 64, 65, 69, 67]);
  // Written over its first note, the command stays where the music starts.
  M.write(score, 0, 0, M.notated(2), { rest: false, pitches: [{ d: 7, alter: 0 }] });
  assert.match(M.toLilyPond(score).source, /\\transposition bes d'2 fis'4 g'4/);
  assert.deepEqual(names(read(M.toLilyPond(score).source)), ["C4", "E4", "F4", "A4", "G4"]);
});

test("an instrument changed in the staff: the flute's notes as they are, the clarinet's from the change", () => {
  const src = `\\new Staff \\with { instrumentName = "Flute" midiInstrument = "flute" } { c''4 d'' e'' f'' | R1 | \\set Staff.instrumentName = "Clarinet" \\set Staff.midiInstrument = "clarinet" \\transposition bes \\key d \\major d'4 e' fis' g' }`;
  const score = read(src);
  assert.deepEqual(names(score), ["C5", "D5", "E5", "F5", "C4", "D4", "E4", "F4"]);
  assert.equal(M.transpositionOf(score.staves[0]), null, "a flute to begin with");
  assert.equal(M.writtenShiftAt(score, 0, 0), null);
  assert.deepEqual(M.writtenShiftAt(score, 0, M.barStart(score, 2)), { steps: 1, semitones: 2 });
  assert.equal(M.keyOf(score, 0, M.barStart(score, 2)), 0, "the key as it sounds stays C");
  const text = M.toLilyPond(score).source;
  assert.match(text, /c''4 d''4 e''4 f''4 \| r1 \| \\key d \\major \\set Staff.instrumentName = "Clarinet" \\set Staff.midiInstrument = "clarinet" \\transposition bes d'4 e'4 fis'4 g'4/);
  assert.deepEqual(played(text).slice(4), [60, 62, 64, 65]);
  // Read again, the same.
  assert.deepEqual(names(read(text)), names(score));
  // At written pitch, the flute as it sounds and the clarinet written; at concert pitch, both as they sound.
  assert.match(M.toLilyPond(score, { written: true }).source, /c''4 d''4 e''4 f''4 \| r1 \| \\key d \\major [^]*d'4 e'4 fis'4 g'4/);
  assert.match(M.toLilyPond(score, { written: false }).source, /\| r1 \| [^]*\\transposition bes c'4 d'4 e'4 f'4/);
});

test("written in at written pitch, after a \\transposition: the note typed is the written one", () => {
  const score = read(CLARINET);
  M.asWritten(score, (s) => {
    assert.equal(M.keyOf(s, 0, 0), 2, "D major, as the clarinet reads it");
    M.write(s, 0, M.barStart(s, 1), q, { rest: false, pitches: [M.nearestPitch(6, 11, M.keyOf(s, 0, 0))] });
  });
  // Written B4 (in D major): A4 as it sounds, written back as b'.
  assert.deepEqual(names(score).slice(4), ["A4", "G4"]);
  assert.match(M.toLilyPond(score).source, /\| b'4 a'2\./);
});

test("a horn's \\transposition f and an alto sax's ees: what \\transpose c says of them, and back", () => {
  assert.equal(M.targetOf("bes"), "d");
  assert.equal(M.targetOf("f"), "g");
  assert.equal(M.targetOf("ees"), "a");
  assert.equal(M.targetOf("bes,"), "d'");
  assert.equal(M.targetOf("a"), "ees");
  assert.equal(M.targetOf("ees'"), "a,");
  assert.equal(M.targetOf("c''"), "c,");
  assert.equal(M.targetOf("c'"), null);
  for (const target of ["d", "g", "a", "d'", "ees", "a,", "a'"]) assert.equal(M.targetOf(M.transpositionFor(target)), target);
  assert.equal(M.transpositionFor(null), "c'");
  const horn = read(`\\new Staff \\with { midiInstrument = "french horn" } { \\transposition f \\key c \\major g'1 }`);
  assert.deepEqual(names(horn), ["C4"]);
  assert.equal(horn.key, -1, "F major as it sounds");
  const sax = read(`\\new Staff { \\transposition ees \\key a \\major a'1 }`);
  assert.deepEqual(names(sax), ["C4"]);
  assert.equal(M.transpositionOf(sax.staves[0]), "a", "the command says it, with no sound named");
});

test("\\transposition beside a staff that sounds as written: the score's key is the flute's", () => {
  const src = `<< \\new Staff \\with { midiInstrument = "flute" } { \\key c \\major c''1 } \\new Staff \\with { midiInstrument = "clarinet" } { \\transposition bes \\key d \\major d'1 } >>`;
  const score = read(src);
  assert.equal(score.key, 0);
  assert.equal(score.staves[1].key, undefined, "the clarinet in the score's key, as it sounds");
  assert.match(M.toLilyPond(score).source, /\\key d \\major \\time 4\/4\n\s+\\transposition bes d'1/);
  // The clarinet first: the same.
  const first = read(`<< \\new Staff { \\transposition bes \\key d \\major d'1 } \\new Staff { \\key c \\major c''1 } >>`);
  assert.equal(first.key, 0);
  assert.equal(first.staves[0].key, undefined);
});

test("a part of a staff with \\transposition is written as its player reads it, its notes and its key", () => {
  const score = read(`<< \\new Staff \\with { instrumentName = "Flute" midiInstrument = "flute" } { c''1 | d''1 } ${CLARINET.replace("{\n", "{ ").replace("| a'1", "| a'1")} >>`);
  const part = M.partOf(score, 1);
  const text = M.toLilyPond(part, { written: true }).source;
  assert.doesNotMatch(text, /\\transpose c/);
  assert.match(text, /\\key d \\major[^]*\\transposition bes d'4 e'4 fis'4 g'4 \| a'1/);
});

test("the review reads a staff's \\transposition: a clarinet's range at written pitch from the change", () => {
  // Concert D3 after \transposition bes is written E3, the clarinet's lowest; C3 is written D3, out.
  const fine = R.review(read(`\\new Staff \\with { instrumentName = "Cl." midiInstrument = "clarinet" } { \\transposition bes e1\\p }`));
  assert.deepEqual(fine.filter((r) => r.rule === "range"), []);
  const low = R.review(read(`\\new Staff \\with { instrumentName = "Cl." midiInstrument = "clarinet" } { \\transposition bes d1\\p }`));
  assert.equal(low.find((r) => r.rule === "range").text, "Cl.: written D3 is out of its range (the lowest written note is E3)");
});
