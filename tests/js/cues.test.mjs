// Cues (#1023): where a part comes back after four bars of rest or more, the
// Review proposes a cue from the part heard most in the bar or two before —
// the loudest, then the busiest. Added, its notes go small over the rests, in
// a CueVoice beside them (what \cueDuring makes, as the editor reads it), not
// played; taken away, the bars are as they were.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as C from "../../public/eui-score/cues.js";
import * as R from "../../public/eui-score/review.js";
import * as F from "../../public/eui-score/feel.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const parse = (src) => ({ ...JSON.parse(score_json(src)), spans: JSON.parse(source_spans(src)) });
function read(src) {
  const result = M.fromParsed(parse(src), src, { parse });
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result.score;
}
/** The score engraved: every drawn note and rest the model numbers is one the engraver draws. */
function engrave(score) {
  const { source, items } = M.toLilyPond(score);
  const view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  assert.equal(view.items.length, items.filter((it) => M.isDrawn(score, it)).length, `the engraver draws every item\n${source}`);
  return source;
}

const staff = (name, sound, music, clef = "treble") => `\\new Staff \\with { instrumentName = "${name}" midiInstrument = "${sound}" } { \\clef ${clef} ${music} }`;
// The oboe rests five bars, and comes back in bar 7; the flute plays all along, loud; the cello softly.
const OBOE = staff("Oboe", "oboe", "c''1\\mf | R1 | R1 | R1 | R1 | R1 | d''1");
const FLUTE = staff("Flute", "flute", "g''4\\f a'' b'' c''' | d'''1 | e'''1 | f'''1 | g'''1 | a''4 b'' c''' d''' | e'''1");
const CELLO = staff("Cello", "cello", "c4\\p d e f | c d e f | c d e f | c d e f | c d e f | g4 a b c' | c1", "bass");
const TRIO = `<< ${OBOE} ${FLUTE} ${CELLO} >>`;

test("proposed: the oboe back after five bars, a cue from the flute — the loudest — over the two bars before", () => {
  const score = read(TRIO);
  const [cue] = C.cueProposals(score);
  assert.deepEqual({ ...cue }, { lane: 0, bar: 6, t: M.barStart(score, 6), rested: 5, from: 4, to: 6, source: 1, cued: false });
  // The Review says it, a hint with the cue to add.
  const remark = R.review(score).find((r) => r.rule === "cue");
  assert.equal(remark.text, "Oboe comes back after 5 bars of rest: a cue from Flute over the bars before");
  assert.equal(remark.level, "hint");
  assert.equal(remark.bar, 6);
});

test("the busiest part when they are as loud; the cello when it is the louder", () => {
  const even = read(`<< ${OBOE} ${FLUTE.replace("\\f", "\\p")} ${CELLO} >>`);
  // Both piano: the flute's 5 notes against the cello's 8 over bars 5 and 6.
  assert.equal(C.cueProposals(even)[0].source, 2);
  const loud = read(`<< ${OBOE} ${FLUTE} ${CELLO.replace("\\p", "\\ff")} >>`);
  assert.equal(C.cueProposals(loud)[0].source, 2);
});

test("added: the flute's notes small over the rests, an octave down into the staff, written and read back; removed, as before", () => {
  const score = read(TRIO);
  const before = M.toLilyPond(score).source;
  const [cue] = C.cueProposals(score);
  const lane = C.addCue(score, cue);
  assert.equal(M.upperOf(score, lane), 0);
  const text = engrave(score);
  // Bars 5 and 6 of the oboe: the flute's G6 and A5… an octave down, as cue notes beside its rests.
  assert.match(text, /<< \{ r1 \} \\new CueVoice \{ g''1 \} >> \| << \{ r1 \} \\new CueVoice \{ a'4 b'4 c''4 d''4 \} >> \| d''1/);
  // The oboe's own notes and its other rests stay.
  assert.match(text, /c''1\\mf \| r1 \| r1 \| r1 \|/);
  // Read back, the cue is there: proposed for taking away.
  const back = read(text);
  assert.equal(M.toLilyPond(back).source, text);
  const [there] = C.cueProposals(back);
  assert.equal(there.cued, true);
  assert.deepEqual([there.from, there.to], [4, 6]);
  assert.equal(R.review(back).find((r) => r.rule === "cue").text, "Oboe: a cue over the rests before it comes back");
  // Not played: the MIDI has the notes it had.
  const ons = (src) => F.readSmf(midi(src, 100, 4, 0)).tracks.flat().filter((ev) => (ev.data[0] & 0xf0) === 0x90 && ev.data[2] > 0).length;
  assert.equal(ons(text), ons(before));
  C.removeCue(back, there.lane, there.from, there.to);
  assert.equal(M.toLilyPond(back).source, before);
  assert.equal(M.voiceLanes(back, 0).length, 1, "its second voice gone with it");
});

test("not proposed: back after three bars, nobody else playing, a drum staff, a line of chord names", () => {
  assert.deepEqual(C.cueProposals(read(`<< ${staff("Oboe", "oboe", "c''1 | R1 | R1 | R1 | d''1")} ${FLUTE} >>`)), []);
  assert.deepEqual(C.cueProposals(read(`<< ${OBOE} ${staff("Flute", "flute", "c'''1 | R1 | R1 | R1 | R1 | R1 | c'''1")} >>`)), []);
  const drums = read(`<< \\new DrumStaff \\drummode { sn1 | R1 | R1 | R1 | R1 | R1 | sn1 } ${FLUTE} >>`);
  assert.deepEqual(C.cueProposals(drums), [], "no cue on a drum staff");
  const fromDrums = read(`<< ${OBOE} \\new DrumStaff \\drummode { sn4 sn sn sn | sn1 | sn1 | sn1 | sn1 | sn1 | sn1 } >>`);
  assert.deepEqual(C.cueProposals(fromDrums), [], "no cue from drums");
});

test("refused: over bars the part plays in, over a cue already there, from nowhere — and nothing written", () => {
  const score = read(TRIO);
  const [cue] = C.cueProposals(score);
  const before = M.toLilyPond(score).source;
  assert.throws(() => C.addCue(score, { ...cue, from: 5, to: 7 }), /bar 7 is not all rests/);
  assert.throws(() => C.addCue(score, { ...cue, source: 0 }), /No other part plays there/);
  assert.throws(() => C.addCue(score, { ...cue, source: null }), /No other part plays there/);
  assert.equal(M.toLilyPond(score).source, before);
  C.addCue(score, cue);
  assert.throws(() => C.addCue(score, cue), /bar 5 is not all rests/);
  assert.throws(() => C.removeCue(score, 0, 1, 3), /no cue there/);
});

test("on a transposing staff the cue is written at its written pitch, with the staff's notes", () => {
  const score = read(`<< ${staff("Clarinet", "clarinet", "\\transposition bes d''1\\mf | R1 | R1 | R1 | R1 | R1 | e''1")} ${FLUTE} >>`);
  const [cue] = C.cueProposals(score);
  C.addCue(score, cue);
  // The flute's concert A5… an octave down (A4), written B4 for the clarinet.
  assert.match(engrave(score), /<< \{ r1 \} \\new CueVoice \{ b'4 cis''4 d''4 e''4 \} >> \| e''1/);
});
