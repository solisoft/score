// #375 slice 4: clefs with an 8 above them, grace notes carrying fingerings,
// a figured bass and guitar chord diagrams — each read, kept through an
// edit elsewhere and written back, edited and taken away, refused where it
// does not apply, merged when two people edit other bars, and carried by
// MusicXML where it has them. And the ottava lines bars taken away or
// pasted used to lose.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";
import { mergeScores } from "../../public/eui-score/merge.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);

function read(src) {
  const result = M.fromParsed(JSON.parse(score_json(src)), src);
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result.score;
}

function stable(score) {
  const { source, items } = M.toLilyPond(score);
  const view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  assert.equal(view.items.length, items.filter((it) => M.isDrawn(score, it)).length, `the engraver sees every drawn item\n${source}`);
  assert.equal(M.toLilyPond(read(source)).source, source, "read back, it writes itself again");
  return source;
}

const merged = (base, mine, theirs) => mergeScores(base, M.toLilyPond(mine).source, M.toLilyPond(theirs).source, { parse: score_json });

// ---- Clefs with an 8 above -------------------------------------------------------

test("clefs: treble^8 and bass^8 read, written back, set and changed, through MusicXML", () => {
  const score = read('{ \\clef "treble^8" c\'\'\'1 | \\clef "bass^8" c\'1 | \\clef "bass_8" c,1 }');
  assert.equal(score.staves[0].clef, "treble^8");
  assert.deepEqual(score.staves[0].clefs, [{ bar: 1, clef: "bass^8" }, { bar: 2, clef: "bass_8" }]);
  M.write(score, 0, 0, q, { rest: false, pitches: [{ d: 28, alter: 0 }] });
  assert.match(stable(score), /\\clef "treble\^8"[\s\S]*\\clef "bass\^8" c'1 \| \\clef "bass_8" c,1/);
  // A letter typed on an empty staff in treble^8 lands an octave up.
  const blank = M.newScore();
  M.setClefAt(blank, 0, 0, "treble^8");
  M.letter(blank, 0, 0, 2);
  assert.equal(blank.staves[0].events[0].pitches[0].d, 23);
  assert.throws(() => M.setClefAt(blank, 0, 1, "treble^22"), /no such clef/);
  const back = read(X.fromMusicXML(X.toMusicXML(score)).source);
  assert.equal(back.staves[0].clef, "treble^8");
  assert.deepEqual(back.staves[0].clefs, score.staves[0].clefs);
});

// ---- Grace notes with fingerings ---------------------------------------------------

test("grace fingerings: read, written back in braces, kept through an edit elsewhere and a transposition", () => {
  const score = read("{ \\grace { c''8-2 } d''2 \\acciaccatura { <e'' g''>16-1-3 } f''2 | c''1 }");
  assert.deepEqual(score.staves[0].events[0].graces[0].fingers, [{ text: "2", dir: 0, head: null, circled: false }]);
  M.write(score, 0, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 15, alter: 0 }] });
  assert.match(stable(score), /\\grace \{ c''8-2 \} d''2 \\acciaccatura \{ <e'' g''>16-1-3 \} f''2 \| d''4/);
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(stable(score), /\\grace \{ d''8-2 \} e''2/);
});

test("grace fingerings: set on the last grace note, changed, again to take away; refused without a grace note", () => {
  const score = read("{ \\grace { c''16 d'' } e''2 f''2 }");
  M.setGraceFingering(score, 0, 0, "3");
  assert.match(stable(score), /\\grace \{ c''16 d''16-3 \} e''2/);
  M.setGraceFingering(score, 0, 0, "4");
  assert.match(stable(score), /d''16-4 \}/);
  M.setGraceFingering(score, 0, 0, "4");
  assert.match(stable(score), /\\grace \{ c''16 d''16 \} e''2/);
  assert.throws(() => M.setGraceFingering(score, 0, 1, "1"), /no grace note/);
  assert.throws(() => M.setGraceFingering(score, 0, 0, "7"), /1 to 5/);
  assert.equal(score.staves[0].events[0].graces[1].fingers, undefined, "nothing left");
});

test("grace fingerings: merged when two people edit other bars; through MusicXML", () => {
  const base = M.toLilyPond(read("{ \\grace { c''8 } d''1 | e''1 }")).source;
  const mine = read(base);
  M.setGraceFingering(mine, 0, 0, "2");
  const theirs = read(base);
  M.write(theirs, 0, M.barStart(theirs, 1), q, { rest: false, pitches: [{ d: 18, alter: 0 }] });
  const out = merged(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  assert.match(out.text, /\\grace \{ c''8-2 \} d''1 \| g''4/);
  const score = read(out.text);
  const xml = X.toMusicXML(score);
  assert.match(xml, /<grace\/><pitch><step>C<\/step><octave>5<\/octave><\/pitch>.*<technical><fingering>2<\/fingering><\/technical>/);
  assert.equal(M.toLilyPond(read(X.fromMusicXML(xml).source)).source, M.toLilyPond(score).source);
});

// ---- A figured bass ------------------------------------------------------------------

const BASS = "<< \\new Staff { \\clef bass c2 g,2 | c1 } \\new FiguredBass \\figuremode { <6 4>4 <7+> s2 | <_ 5->1 } >>";

test("figured bass: read, written back, kept through an edit elsewhere", () => {
  const score = read(BASS);
  assert.equal(score.staves[1].figures, true);
  assert.deepEqual(score.staves[1].events.map((ev) => ev.figure ?? "·"), ["6 4", "7+", "·", "_ 5-"]);
  M.write(score, 0, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 4, alter: 0 }] });
  assert.match(stable(score), /\\new FiguredBass \\figuremode \{\n\s*<6 4>4 <7\+>4 s2 \| <_ 5->1\n\s*\}/);
});

test("figured bass: added under a staff, figures typed beat by beat, changed and taken away; refused", () => {
  const score = M.fromTemplate("blank", { bars: 2 });
  const line = M.addFigureStaff(score, 0);
  assert.equal(line, 1);
  assert.equal(M.figureLineUnder(score, 0), 1);
  M.setFigureAt(score, line, 0, "6");
  M.setFigureAt(score, line, M.nextBeat(score, 0), "6 4");
  M.setFigureAt(score, line, M.barStart(score, 1), " 7  ");
  assert.match(stable(score), /\\figuremode \{\n\s*<6>4 <6 4>2\. \| <7>1/);
  M.setFigureAt(score, line, q, "");
  assert.match(stable(score), /<6>4 s2\. \| <7>1/);
  const before = M.toLilyPond(score).source;
  assert.throws(() => M.setFigureAt(score, line, 0, "Cm7"), /not figures/);
  assert.throws(() => M.setFigureAt(score, 0, 0, "6"), /not a figured bass/);
  assert.throws(() => M.letter(score, line, 0, 2), /holds figures, not notes/);
  assert.throws(() => M.addFigureStaff(score, 0), /already/);
  assert.equal(M.toLilyPond(score).source, before, "nothing changed");
});

test("figured bass: merged when two people edit other bars; through MusicXML both ways", () => {
  const base = M.toLilyPond(read(BASS)).source;
  const mine = read(base);
  M.setFigureAt(mine, 1, M.barStart(mine, 1), "6");
  const theirs = read(base);
  M.write(theirs, 0, 0, q, { rest: false, pitches: [{ d: 2, alter: 0 }] });
  const out = merged(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  assert.match(out.text, /<6 4>4 <7\+>4 s2 \| <6>1/);
  const score = read(BASS);
  const xml = X.toMusicXML(score);
  assert.equal((xml.match(/<score-part /g) ?? []).length, 1, "no part of its own");
  assert.match(xml, /<figured-bass><figure><figure-number>6<\/figure-number><\/figure><figure><figure-number>4<\/figure-number><\/figure><duration>1<\/duration><\/figured-bass>/);
  assert.match(xml, /<figure><figure-number>7<\/figure-number><suffix>sharp<\/suffix><\/figure>/);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.equal(M.toLilyPond(read(source)).source, M.toLilyPond(score).source);
});

// ---- Guitar chord diagrams ------------------------------------------------------------

test("chord diagrams: read, written back, kept through an edit elsewhere", () => {
  const score = read('{ c\'2^\\markup \\fret-diagram-terse "x;3;2;o;1;o;" g2^\\markup \\fret-diagram "c:6-3-3;6-3;5-5;4-5;3-4;2-3;1-3;" | c\'1 }');
  assert.equal(score.staves[0].events[0].fret, "x;3;2;o;1;o;");
  assert.equal(score.staves[0].events[1].fret, "3;5;5;4;3;3;|6-3-3");
  M.write(score, 0, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 9, alter: 0 }] });
  const source = stable(score);
  assert.match(source, /c'2\^\\markup \\fret-diagram "6-x;5-3;4-2;3-o;2-1;1-o;"/);
  assert.match(source, /g2\^\\markup \\fret-diagram "c:6-3-3;6-3;5-5;4-5;3-4;2-3;1-3;"/);
});

test("chord diagrams: typed as x32010, changed, taken away; refused on a rest or for a shape that is not one", () => {
  const score = read("{ c'2 r2 }");
  M.setFretDiagram(score, 0, 0, "x32010");
  assert.equal(M.fretText(score.staves[0].events[0].fret), "x32010");
  assert.match(stable(score), /c'2\^\\markup \\fret-diagram "6-x;5-3;4-2;3-o;2-1;1-o;"/);
  M.setFretDiagram(score, 0, 0, "x 10 12 12 12 x");
  assert.equal(M.fretText(score.staves[0].events[0].fret), "x 10 12 12 12 x");
  stable(score);
  assert.throws(() => M.setFretDiagram(score, 0, 0, "x3201"), /not a guitar chord/);
  assert.throws(() => M.setFretDiagram(score, 0, 0, "x;3;2;0;1;30"), /not a guitar chord/);
  assert.throws(() => M.setFretDiagram(score, 0, 1, "x32010"), /select a note/);
  M.setFretDiagram(score, 0, 0, "");
  assert.doesNotMatch(stable(score), /fret-diagram/);
  // A note made a rest takes its diagram with it.
  M.setFretDiagram(score, 0, 0, "x32010");
  M.remove(score, 0, 0);
  assert.doesNotMatch(stable(score), /fret-diagram/);
});

test("chord diagrams: merged when two people edit other bars", () => {
  const base = M.toLilyPond(read("{ c'1 | g1 }")).source;
  const mine = read(base);
  M.setFretDiagram(mine, 0, 0, "x32010");
  const theirs = read(base);
  M.setFretDiagram(theirs, 0, 1, "320003");
  const out = merged(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  const back = read(out.text);
  assert.deepEqual(back.staves[0].events.map((ev) => ev.fret), ["x;3;2;o;1;o;", "3;2;o;o;o;3;"]);
});

// ---- Ottava lines through bars taken away and pasted ---------------------------------

const OTTAVA = "{ c'1 | \\ottava #1 c'''1 | d'''1 | \\ottava #0 e'1 | f'1 | g'1 }";

test("ottava: bars taken away keep the line where it goes on, and end it where it ended", () => {
  const start = read(OTTAVA);
  M.deleteBars(start, 1, 1);
  assert.match(stable(start), /c'1 \| \\ottava #1 d'''1 \| \\ottava #0 e'1/, "its start gone, the line goes on from the bar after");
  const end = read(OTTAVA);
  M.deleteBars(end, 2, 3);
  assert.match(stable(end), /\\ottava #1 c'''1 \| \\ottava #0 f'1/, "its end gone, it still ends");
  const inside = read(OTTAVA);
  M.deleteBars(inside, 2, 2);
  assert.match(stable(inside), /\\ottava #1 c'''1 \| \\ottava #0 e'1/);
});

test("ottava: a section copied under a line pastes with it, and what it is pasted over keeps its own", () => {
  const score = read(OTTAVA);
  M.pasteSection(score, 0, 4, M.copySection(score, [0], 2, 2));
  assert.match(stable(score), /\\ottava #0 e'1 \|\s+\\ottava #1 d'''1 \| \\ottava #0 g'1/);
  // Pasted inside the line: the line goes on over it, and still ends where it did.
  const inside = read(OTTAVA);
  M.pasteSection(inside, 0, 2, M.copySection(inside, [0], 4, 4));
  assert.match(stable(inside), /\\ottava #1 c'''1 \| f'1 \| \\ottava #0 e'1/);
  // Two bars of it pasted: the line is one, not broken after its first note.
  const two = read(OTTAVA);
  M.pasteSection(two, 0, 4, M.copySection(two, [0], 1, 2));
  assert.match(stable(two), /\| \\ottava #1 c'''1 \| d'''1 \| \\ottava #0 /);
  // The clipboard as LilyPond carries the line it was copied under.
  assert.match(M.clipText(M.copy(read(OTTAVA), 0, 2, 2)), /^\\ottava #1 d'''1$/);
});
