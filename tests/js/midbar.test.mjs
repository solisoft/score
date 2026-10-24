// A clef or a key changed inside a bar (#360): the engraver draws it since
// Soli 2.28.5, so the editor reads it, keeps it through every edit, writes
// it back before the note it falls at, and carries it through MusicXML.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);
const h = M.notated(2);

function read(src) {
  const result = M.fromParsed(JSON.parse(score_json(src)));
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

test("a clef changed inside a bar is read, kept through an edit, written before its note", () => {
  const { score, lost } = read("{ c''2 \\clef bass c2 | d1 | \\clef treble e''1 }");
  assert.equal(lost, undefined);
  assert.deepEqual(score.staves[0].midClefs, [{ bar: 0, pos: h, clef: "bass" }]);
  assert.deepEqual(score.staves[0].clefs, [{ bar: 2, clef: "treble" }]);
  // The clef in force: treble at the bar's start, bass from its middle and in the next bar.
  assert.equal(M.clefAt(score, 0, 0), "treble");
  assert.equal(M.clefAt(score, 0, 0, h), "bass");
  assert.equal(M.clefAt(score, 0, 1), "bass");
  // An edit elsewhere keeps it where it is.
  M.write(score, 0, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 1, alter: 0 }] });
  assert.match(engrave(score), /c''2 \\clef bass c2 \| d4 d2\. \| \\clef treble e''1/);
  // The note it stood before written over: the clef stays at its time, before what is there now.
  M.write(score, 0, h, h, { rest: true });
  assert.match(engrave(score), /c''2 \\clef bass r2 \|/);
});

test("a clef inside a bar written over by a longer note goes before the next note", () => {
  const { score } = read("{ c''4 d''4 \\clef bass c4 d4 | e1 }");
  M.write(score, 0, q, h, { rest: false, pitches: [{ d: 14, alter: 0 }] });
  assert.match(engrave(score), /c''4 c''2 \\clef bass d4 \| e1/);
});

test("a key changed inside a bar: read, the notes after it typed in it, kept and written back", () => {
  const { score } = read("{ c''2 \\key d \\major d''2 | e''1 | \\key c \\major c''1 }");
  assert.deepEqual(score.midKeys, [{ bar: 0, pos: h, key: 2 }]);
  // The return to C at bar 2 is a change still: bar 1 is in D.
  assert.equal(M.changeAt(score, 2)?.key, 0);
  assert.equal(M.keyOf(score, 0, 0), 0);
  assert.equal(M.keyOf(score, 0, h), 2);
  assert.equal(M.keyOf(score, 0, M.barStart(score, 1)), 2);
  // A letter typed after it is spelled in D: an F is F sharp.
  M.letter(score, 0, 2, 3);
  assert.equal(score.staves[0].events[2].pitches[0].alter, 1);
  const source = engrave(score);
  assert.match(source, /c''2 \\key d \\major d''2 \| fis''1 \| \\key c \\major c''1/);
  // Read back: the same.
  assert.deepEqual(read(source).score.midKeys, [{ bar: 0, pos: h, key: 2 }]);
});

test("a key and a clef inside a bar on a piano's two staves, in a minor mode", () => {
  const src = "\\new PianoStaff << \\new Staff { c''2 \\key a \\minor a'2 | b'1 } \\new Staff { \\clef bass c2 \\key a \\minor \\clef treble a'2 | b1 } >>";
  const { score } = read(src);
  assert.deepEqual(score.midKeys, [{ bar: 0, pos: h, key: 0, mode: "minor" }]);
  assert.deepEqual(score.staves[1].midClefs, [{ bar: 0, pos: h, clef: "treble" }]);
  const source = engrave(score);
  assert.match(source, /c''2 \\key a \\minor a'2/);
  assert.match(source, /c2 \\clef treble \\key a \\minor a'2/);
  // Staves that change key apart inside a bar are left to the text.
  assert.ok(M.fromParsed(JSON.parse(score_json("\\new PianoStaff << \\new Staff { c''2 \\key d \\major a'2 } \\new Staff { \\clef bass c2 a2 } >>"))).unsupported.includes("staves changing key apart"));
});

test("inside a bar: changes move with bars inserted, deleted, and a metre changed", () => {
  const { score } = read("{ c''1 | c''2 \\clef bass \\key g \\major c2 | d1 }");
  M.insertBars(score, 0, 1);
  assert.deepEqual(score.staves[0].midClefs, [{ bar: 2, pos: h, clef: "bass" }]);
  assert.deepEqual(score.midKeys, [{ bar: 2, pos: h, key: 1 }]);
  engrave(score);
  // The bar before it deleted: it moves back.
  M.deleteBars(score, 0, 0);
  assert.equal(score.staves[0].midClefs[0].bar, 1);
  // The bar it is in deleted: it goes, and what it set holds on in the bars after.
  M.deleteBars(score, 1, 1);
  assert.deepEqual(score.staves[0].midClefs, []);
  assert.deepEqual(score.midKeys, []);
  assert.equal(M.clefAt(score, 0, 1), "bass");
  assert.equal(M.keyOf(score, 0, M.barStart(score, 1)), 1);
  assert.match(engrave(score), /c''1 \| \\clef bass \\key g \\major d1/);
  // A metre changed: the change keeps its time, in whichever bar it falls now.
  const other = read("{ c''2 \\clef bass c2 | d1 }").score;
  M.setTimeAt(other, 0, 2, 4);
  assert.deepEqual(other.staves[0].midClefs, [{ bar: 1, pos: 0, clef: "bass" }]);
  assert.match(engrave(other), /c''2 \| \\clef bass c2 \|/);
  // The last bar removed takes its own with it.
  const last = read("{ c''1 | r2 \\clef bass r2 }").score;
  M.removeLastBar(last);
  assert.equal(last.staves[0].midClefs.length, 0);
});

test("a key inside a bar moves with the score transposed", () => {
  const { score } = read("{ c''2 \\key d \\major d''2 }");
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.deepEqual(score.midKeys, [{ bar: 0, pos: h, key: 4 }]);
  assert.match(engrave(score), /d''2 \\key e \\major e''2/);
});

test("musicxml: a clef and a key inside a measure go out and come back", () => {
  const { score } = read("\\new PianoStaff << \\new Staff { c''2 \\key d \\major d''2 | e''1 } \\new Staff { \\clef bass c2 \\clef treble \\key d \\major a'2 | b1 } >>");
  const xml = X.toMusicXML(score);
  assert.match(xml, /<attributes><key><fifths>2<\/fifths><\/key><\/attributes>\s*<note>/);
  // A piano is one part (#375): the second staff's clef changes on its own staff.
  assert.match(xml, /<attributes><clef number="2"><sign>G<\/sign><line>2<\/line><\/clef><\/attributes>/);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  const back = read(source).score;
  assert.deepEqual(back.midKeys, [{ bar: 0, pos: h, key: 2 }]);
  assert.deepEqual(back.staves[1].midClefs, [{ bar: 0, pos: h, clef: "treble" }]);
  assert.equal(M.toLilyPond(back).source, M.toLilyPond(score).source);
});

test("musicxml: an import with a clef in the middle of a measure opens in the editor", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>half</type></note>
<attributes><clef><sign>C</sign><line>4</line></clef></attributes>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note></measure></part></score-partwise>`;
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  const { score } = read(source);
  assert.deepEqual(score.staves[0].midClefs, [{ bar: 0, pos: h, clef: "tenor" }]);
  engrave(score);
});
