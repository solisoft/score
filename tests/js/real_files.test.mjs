// Real LilyPond files open (#359): what the engraver honours since Soli
// 2.28.5 — cis! and cis?, \stemUp, \autoBeamOff, breath marks, bowings,
// \laissezVibrer, \repeatTie, \cresc in words, text spans — is kept by the
// editor through every edit; the layout settings it passes over are named
// before the first rewrite drops them; several movements are left to the text.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);
const A4 = { rest: false, pitches: [{ d: 12, alter: 0 }] };

function parse(src) {
  return M.fromParsed(JSON.parse(score_json(src)));
}

function read(src) {
  const result = parse(src);
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result;
}

function engrave(score) {
  const { source, items } = M.toLilyPond(score);
  let view;
  try {
    view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  } catch (e) {
    throw new Error(`${e.message ?? e}\n${source}`);
  }
  assert.equal(view.items.length, items.length, `the engraver numbers what the model does\n${source}`);
  return source;
}

/** Read, a note written in the last bar, written back. */
function editedElsewhere(src) {
  const { score, lost } = read(src);
  M.write(score, 0, M.barStart(score, M.barsOf(score) - 1), q, A4);
  return { score, lost, source: engrave(score) };
}

const EXCERPT = String.raw`\header { title = "Étude" encodingsoftware = "MuseScore 4" }
\layout { \context { \Staff \consists "Ambitus_engraver" } }
\new Staff \with { \override StaffSymbol.color = #grey } {
  \stemUp \autoBeamOff c''8\downbow d''8\upbow cis''!4\breathe d''?4 e''4\flageolet |
  \stemNeutral \autoBeamOn f''4\cresc g''4 a''4\espressivo b''4\! |
  \override TextSpanner.bound-details.left.text = "rit." c'''2\startTextSpan b''2\stopTextSpan\laissezVibrer |
  \once \override NoteHead.color = #red a''2\repeatTie \caesura g''2 | f''1
}`;

test("kept: what real files write survives an edit elsewhere", () => {
  const { lost, source } = editedElsewhere(EXCERPT);
  assert.match(source, /\\stemUp \\autoBeamOff c''8\\downbow d''8\\upbow cis''!4 \\breathe d''\?4 e''4\\flageolet \|/);
  assert.match(source, /\\stemNeutral \\autoBeamOn f''4\\cresc g''4 a''4\\espressivo b''4\\! \|/);
  assert.match(source, /\\override TextSpanner\.bound-details\.left\.text = "rit\." c'''2\\startTextSpan b''2\\laissezVibrer\\stopTextSpan \|/);
  assert.match(source, /a''2\\repeatTie \\caesura g''2 \|/);
  // The settings passed over are named before the rewrite drops them.
  assert.equal(lost.length, 1);
  assert.match(lost[0], /^the settings the engraver passes over \(/);
  for (const name of ["\\override StaffSymbol.color in \\with", "\\override NoteHead.color", "\\consists in \\layout", "the header field 'encodingsoftware'"]) assert.ok(lost[0].includes(name), `${name} in ${lost[0]}`);
  // Read again, every one is there still.
  const back = read(source).score.staves[0].events;
  assert.equal(back[0].stemDir, 1);
  assert.equal(back[0].noAutoBeam, true);
  assert.deepEqual(back[2].forced, [14]);
  assert.deepEqual(back[3].cautionary, [15]);
  assert.equal(back[2].breath, "breathe");
  assert.deepEqual([back[0].arts, back[1].arts, back[4].arts, back[7].arts], [["downbow"], ["upbow"], ["flageolet"], ["espressivo"]]);
  assert.equal(back[5].hairpinWords, "cresc");
  assert.equal(back[9].spanStart, "rit.");
  assert.equal(back[10].spanEnd, true);
  assert.equal(back[10].lv, true);
  assert.equal(back[11].repeatTie, true);
  assert.equal(back[11].breath, "caesura");
  // A plain piece has nothing passed over.
  assert.equal(read("{ c''1 }").lost, undefined);
});

test("kept: stems and beaming switched hold over notes written over and between", () => {
  const { score } = read("{ \\stemDown c''4 d'' e'' f'' | \\stemNeutral g''1 }");
  // The note the switch is written on is written over: the switch stays, on what is there now.
  M.write(score, 0, 0, q, A4);
  M.write(score, 0, q, q, { rest: true });
  const source = engrave(score);
  assert.match(source, /\\stemDown a'4 r4 e''4 f''4 \| \\stemNeutral g''1/);
  // A note written after the switch takes the stems in force, with no switch of its own.
  M.write(score, 0, q, q, { rest: false, pitches: [{ d: 14, alter: 0 }] });
  assert.match(engrave(score), /\\stemDown a'4 c''4 e''4/);
  assert.equal(score.staves[0].events[1].stemDir, undefined);
});

test("kept: a forced accidental follows its note moved, leaves it made a rest, and is never a grace note's", () => {
  const { score } = read("{ \\acciaccatura cis''8 cis''!4 <e'' gis''?>4 r2 }");
  M.move(score, 0, 0, "step", 1);
  assert.deepEqual(score.staves[0].events[0].forced, [15]);
  const source = engrave(score);
  assert.match(source, /\\acciaccatura cis''8 d''!4 <e'' gis''\?>4/);
  M.remove(score, 0, 0);
  assert.equal(score.staves[0].events[0].forced, undefined);
  assert.doesNotMatch(engrave(score), /!/);
});

test("reminder accidentals: forced, cautionary, on one head of a chord, again to take away", () => {
  const { score } = read("{ <c'' e''>4 d''4 r2 }");
  M.toggleReminder(score, 0, 0, "forced", 1);
  assert.match(engrave(score), /<c'' e''!>4/);
  M.toggleReminder(score, 0, 0, "cautionary");
  assert.match(engrave(score), /<c''\? e''\?>4/);
  assert.equal(score.staves[0].events[0].forced, undefined);
  M.toggleReminder(score, 0, 0, "cautionary");
  assert.match(engrave(score), /<c'' e''>4/);
  assert.equal(score.staves[0].events[0].cautionary, undefined);
  assert.throws(() => M.toggleReminder(score, 0, 2, "forced"), /select a note|rest/i);
  assert.throws(() => M.toggleReminder(score, 0, 1, "loud"), /forced or cautionary/);
});

test("breath marks and bowings from the tools: set, again to take away", () => {
  const { score } = read("{ c''4 d''4 e''2 }");
  M.toggleBreath(score, 0, 1);
  M.toggleArticulation(score, 0, 0, "upbow");
  M.toggleArticulation(score, 0, 2, "downbow");
  assert.match(engrave(score), /c''4\\upbow d''4 \\breathe e''2\\downbow/);
  M.toggleBreath(score, 0, 1, "caesura");
  assert.match(engrave(score), /d''4 \\caesura e''2/);
  M.toggleBreath(score, 0, 1, "caesura");
  assert.doesNotMatch(engrave(score), /caesura|breathe/);
  assert.throws(() => M.toggleBreath(score, 0, 1, "sigh"), /breathe or caesura/);
  // A breath on a rest is kept apart from the rests merged around it.
  const rests = read("{ c''4 r4 \\breathe r2 }").score;
  M.write(rests, 0, 0, q, A4);
  assert.match(engrave(rests), /a'4 r4 \\breathe r2/);
});

test("a crescendo in words becomes a wedge when it is set again by hand; a long note keeps its marks on the right piece", () => {
  const { score } = read("{ c''4\\dim d''4 e''2\\! }");
  assert.match(engrave(score), /c''4\\dim d''4/);
  M.setHairpin(score, 0, 0, 2, "<");
  assert.match(engrave(score), /c''4\\< d''4 e''2\\!/);
  // A note cut at the bar line: the breath after its last piece, the forced accidental on its first.
  const long = read("{ r2 cis''!2\\laissezVibrer \\breathe | r1 }").score;
  M.setDuration(long, 0, 1, 1, 0);
  assert.match(engrave(long), /cis''!2~ \| cis''2\\laissezVibrer \\breathe/);
});

test("several movements are engraved, and edited in the text", () => {
  const two = parse("\\score { { c''1 } \\header { piece = \"I\" } } \\score { { d''1 } \\header { piece = \"II\" } }");
  assert.equal(two.score, undefined);
  assert.deepEqual(two.unsupported, ["several movements (one \\score after another): edit them one at a time in the text"]);
  // A book part is one too; a movement the engraver cannot set (other staves) as well.
  assert.ok(parse("\\book { \\bookpart { { c''1 } } \\bookpart { { d''1 } } }").unsupported[0].startsWith("several movements"));
  assert.ok(parse("\\score { { c''1 } } \\score { << { c''1 } \\new Staff { d''1 } >> }").unsupported[0].startsWith("several movements"));
});

test("the names of what is passed over: each once, the long list cut short", () => {
  assert.deepEqual(M.passedOver(["\\override Stem.color is not drawn", "\\override Stem.color is not drawn", "\\paper's ragged-right is not read", "\\include \"x.ly\" is not read: a score reads one source", "movement 2 is not engraved: …"]), ["\\override Stem.color", "\\paper's ragged-right", "\\include \"x.ly\""]);
  const many = M.passedOver(Array.from({ length: 9 }, (_, k) => `\\override Thing${k}.color is not drawn`));
  assert.equal(many.length, 6);
  assert.equal(many[5], "4 more");
  assert.deepEqual(M.passedOver(undefined), []);
});

const LILYPOND_224 = String.raw`{ \time 4/4
  c''4\segno d''4 e''4 f''4\coda | \segnoMark 1 g''1 | \section \sectionLabel "Trio" a''4 b''4 c'''2 |
  \repeat volta 3 { d''1 } \alternative { \volta 1,2 { e''1 } \volta 3 { f''1 } }
  \textMark "To Coda" g''1 | c''4\harmonic <c'' g''\harmonic>2. \codaMark \default | e''1 \bar "|." }`;

test("LilyPond 2.24's marks, sections, endings and harmonics open and survive an edit (#433)", () => {
  const { lost, source } = editedElsewhere(LILYPOND_224);
  assert.equal(lost, undefined, "nothing left out");
  // A segno and a coda over a note, a harmonic on a note and on one head of a chord.
  assert.match(source, /c''4\\segno d''4 e''4 f''4\\coda/);
  assert.match(source, /c''4\\harmonic <c'' g''\\harmonic>2\./);
  // The marks and the section's words come back as the editor writes them.
  // \\section is its double bar, a \\sectionLabel a mark of words, "To Coda" the jump it means.
  assert.match(source, /\\segnoMark g''1 \| \\bar "\|\|" \\mark "Trio" a''4/);
  assert.match(source, /\\repeat volta 3 \{ d''1 \} \\alternative \{ \{ e''1 \} \{ f''1 \\jump "To Coda" \} \}/);
  assert.match(source, /\\codaMark/);
  // Read again, every one is there still.
  const back = read(source).score.staves[0].events;
  assert.deepEqual([back[0].arts, back[3].arts], [["segno"], ["coda"]]);
  const harmonics = back.filter((e) => e.harmonics).map((e) => e.harmonics);
  assert.deepEqual(harmonics, [[14], [18]]);
});

test("a harmonic follows its note when it is transposed (#433)", () => {
  const { score } = read(String.raw`{ <c'' g''\harmonic>1 }`);
  M.transpose(score, { steps: 1, semitones: 2 });
  const ev = score.staves[0].events[0];
  assert.deepEqual(ev.harmonics, [ev.pitches[1].d]);
  assert.match(engrave(score), /<d'' a''\\harmonic>1/);
});
