// What the first edit used to lose (#361): read from a text, an edit made
// elsewhere, written back — each element is still there, and the engraver
// still draws it. What the model cannot keep is named, for the page to say.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";
import { onsetSeconds } from "./midi_onsets.mjs";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);
const A4 = { rest: false, pitches: [{ d: 12, alter: 0 }] };

/** The model of `src`: it must read, every tool on. */
function read(src) {
  const result = M.fromParsed(JSON.parse(score_json(src)));
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result;
}

/** The score engraved; its LilyPond, the engraver numbering every note and rest as the model does. */
function engrave(score) {
  const { source, items } = M.toLilyPond(score);
  let view;
  try {
    view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  } catch (e) {
    throw new Error(`${e.message ?? e}\n${source}`);
  }
  // A spacer has no ink: it is numbered, and not drawn.
  const drawn = items.filter((it) => M.isDrawn(score, it));
  assert.equal(view.items.length, drawn.length, `the engraver sees every drawn item\n${source}`);
  assert.ok(view.items.every((it) => items[it.item]), "every item the engraver numbers is an event of the model");
  return source;
}

/** Read, edited away from the element (a note written in the last bar), written back. */
function editedElsewhere(src, { staff = 0 } = {}) {
  const { score, lost } = read(src);
  M.write(score, staff, M.barStart(score, M.barsOf(score) - 1), q, A4);
  return { score, lost, source: engrave(score) };
}

test("kept: an invisible rest stays a spacer, a piano left hand gains no rests", () => {
  const src = "\\new PianoStaff << \\new Staff { c'1 | d'1 | e'1 } \\new Staff { \\clef bass s1 | c1 | s2 g,2 } >>";
  const { score, lost, source } = editedElsewhere(src);
  assert.equal(lost, undefined, "nothing to warn about");
  assert.match(source, /\\clef bass .*\n\s+s1 \| c1 \| s2 g,2 /);
  assert.equal(score.staves[1].events[0].spacer, true);
  // Read back, the spacers are spacers still.
  const back = read(source).score;
  assert.deepEqual(back.staves[1].events.map((ev) => Boolean(ev.spacer)), [true, false, true, false]);
  // Written over, a spacer's note shows; what is left of it stays a spacer.
  M.write(score, 1, 0, q, { rest: false, pitches: [{ d: 0, alter: 0 }] });
  assert.match(engrave(score), /c4 s2\. \| c1/);
  // A second voice's spacer, too.
  const two = editedElsewhere("{ << { c''1 } \\\\ { s2 e'2 } >> | d''1 }");
  assert.match(two.source, /<< \{ c''1 \} \\\\ \{ s2 e'2 \} >>/);
});

test("kept: spacers side by side become one, never a drawn rest", () => {
  const { score } = read("\\new PianoStaff << \\new Staff { c'1 } \\new Staff { \\clef bass s4 s4 s2 } >>");
  M.tidy(score, score.staves[1]);
  assert.match(engrave(score), /\\clef bass .*\n\s+s1 /);
});

test("kept: beams written by hand", () => {
  const { lost, source } = editedElsewhere("{ c'8[ d' e' f'] g'8[ a'] b'4 | c''1 }");
  assert.equal(lost, undefined);
  assert.match(source, /c'8\[ d'8 e'8 f'8\] g'8\[ a'8\] b'4/);
  // A beam an edit breaks is not written half: its ] alone would be refused.
  const { score } = read("{ c'8[ d' e' f'] g'2 }");
  M.write(score, 0, 0, q, A4);
  const written = engrave(score);
  assert.doesNotMatch(written, /[[\]]/);
  // Its end changed into a quarter: the beam goes, the notes stay.
  const { score: other } = read("{ c'8[ d' e' f'] g'2 }");
  M.setDuration(other, 0, 3, 4, 0);
  assert.doesNotMatch(engrave(other), /[[\]]/);
});

test("kept: a beam across a bar line cannot be, and is named", () => {
  const result = read("{ c'2. d'8[ e' | f'8] g'8 a'4 b'2 }");
  assert.deepEqual(result.lost, ["a beam across a bar line, or around a rest or a longer note"]);
  assert.doesNotMatch(engrave(result.score), /[[\]]/);
});

test("kept: a repeat played three times", () => {
  const { score, source } = editedElsewhere("{ \\repeat volta 3 { c'1 } d'1 }");
  assert.match(source, /\\repeat volta 3 \{ c'1 \}/);
  assert.deepEqual(score.repeats, [{ from: 0, to: 0, endings: [], times: 3 }]);
  assert.deepEqual(M.playOrder(score), [0, 0, 0, 1]);
  // Played so: three c's, then the a written over the last bar's d, and what is left of the d.
  const heard = onsetSeconds(midi(M.toLilyPond(score, { unfold: true }).source, 100, 4, 0));
  assert.equal(heard.length, 5);
  // Its bounds moved, the count stays; the metre changed, too.
  M.addBars(score, 1);
  M.setRepeat(score, 0, { to: 1 });
  assert.equal(score.repeats[0].times, 3);
  M.setTime(score, 2, 4);
  assert.equal(score.repeats[0].times, 3);
  assert.match(engrave(score), /\\repeat volta 3 \{/);
  // As many times as its endings: nothing more to keep.
  assert.deepEqual(read("{ \\repeat volta 3 { c'1 } \\alternative { { d'1 } { e'1 } { f'1 } } }").score.repeats, [{ from: 0, to: 0, endings: [1, 1, 1] }]);
});

test("kept: the key's mode, at the start and where it changes", () => {
  const { score, source } = editedElsewhere("{ \\key d \\dorian c'1 | \\key e \\minor d'1 | \\key a \\minor e'1 | f'1 }");
  assert.match(source, /\\key d \\dorian/);
  assert.match(source, /\| \\key e \\minor d'1/);
  // The same signature, another mode: a change still.
  assert.match(source, /\| \\key a \\minor e'1/);
  assert.equal(score.mode, "dorian");
  assert.equal(M.modeAt(score, 2), "minor");
  // Transposed a tone up: E dorian, F sharp minor.
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(engrave(score), /\\key e \\dorian/);
  // A change of key set by hand is a major key's.
  M.setKeyAt(score, 3, 3);
  assert.match(engrave(score), /\\key a \\major/);
  // Minor, read and written back.
  assert.match(engrave(read("{ \\key a \\minor a'1 }").score), /\\key a \\minor/);
});

test("kept: bold words", () => {
  const { score, source } = editedElsewhere("{ c'1^\\markup \\bold \"Refrain\" | d'1_\\markup \\italic \"dolce\" | e'1 }");
  assert.match(source, /c'1\^\\markup \\bold "Refrain"/);
  assert.match(source, /d'1_\\markup \\italic "dolce"/);
  // Bold, a short word is not taken for a chord symbol.
  const chord = read("{ c'1^\\markup \\bold \"C\" }").score;
  assert.equal(chord.staves[0].events[0].chord, "");
  assert.match(engrave(chord), /\^\\markup \\bold "C"/);
  // Changed, it stays bold.
  M.setText(score, 0, 0, "staff", "Chorus");
  assert.match(engrave(score), /c'1\^\\markup \\bold "Chorus"/);
});

test("kept: a double bar line between bars, a final one before a coda", () => {
  const { source } = editedElsewhere("{ c'1 \\bar \"||\" d'1 \\bar \"|.\" e'1 | f'1 }");
  assert.match(source, /c'1 \| \\bar "\|\|" d'1 \| \\bar "\|\." e'1/);
});

test("kept: what cannot be is named, for the page to say before it goes", () => {
  // A double bar line inside a bar ends it there, as the engraver ends it (#402): kept.
  assert.equal(read("{ c'2 \\bar \"||\" d'2 e'1 }").lost, undefined);
  assert.deepEqual(read("{ c'1 \\override NoteHead.color = #red d'1 }").lost, ["the settings the engraver passes over (\\override NoteHead.color)"]);
  // A plain piece has nothing to name.
  assert.equal(read("{ c'1 \\bar \"||\" d'1 }").lost, undefined);
});

test("musicxml: spacers, beams, a repeat's times, the key's mode and bold words go out and come back", () => {
  const { score } = read("\\new PianoStaff << \\new Staff { \\key d \\dorian \\repeat volta 3 { c''8[ d'' e'' f''] g''2^\\markup \\bold \"Loud\" } d''1 } \\new Staff { \\clef bass s1 | c1 } >>");
  const xml = X.toMusicXML(score);
  assert.match(xml, /<mode>dorian<\/mode>/);
  assert.match(xml, /<repeat direction="backward" times="3"\/>/);
  assert.match(xml, /<beam number="1">begin<\/beam>/);
  assert.match(xml, /<beam number="1">continue<\/beam>/);
  assert.match(xml, /<beam number="1">end<\/beam>/);
  assert.match(xml, /font-weight="bold">Loud</);
  assert.match(xml, /<note print-object="no"><rest/);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.match(source, /\\key d \\dorian/);
  assert.match(source, /\\repeat volta 3 \{/);
  assert.match(source, /c''8\[ d''8 e''8 f''8\]/);
  assert.match(source, /\\markup \\bold "Loud"/);
  assert.match(source, /s1/);
  const back = read(source).score;
  assert.equal(back.mode, "dorian");
  assert.equal(back.repeats[0].times, 3);
  assert.equal(back.staves[1].events[0].spacer, true);
  engrave(back);
});
