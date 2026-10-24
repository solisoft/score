// The commands #375 slice 3 adds to the editor: stems turned up, down or back
// over the selection, beams written by hand (joined, taken away, broken), and
// notes spelled the other way (C♯ ↔ D♭). Each is set, kept through an edit
// elsewhere, written and read back, refused where it does not apply, merged
// when two people edit other bars, and sent to MusicXML.
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

const EIGHTHS = "{ c''8 d'' e'' f'' g'' a'' b'' c''' | c''1 }";

// ---- Stems ----------------------------------------------------------------------

test("stems: up over the selection, what follows as it was; down; as the voice wants; read back", () => {
  const score = read("{ c''4 d'' e'' f'' | g''1 }");
  M.setStem(score, 0, 1, 2, 1);
  assert.match(stable(score), /c''4 \\stemUp d''4 e''4 \\stemNeutral f''4/);
  assert.equal(M.stemAt(score, 0, 2), 1);
  assert.equal(M.stemAt(score, 0, 3), 0);
  // Down over the end of it and past it: the up stops where the down starts.
  M.setStem(score, 0, 2, 4, -1);
  assert.match(stable(score), /\\stemUp d''4 \\stemDown e''4 f''4 \| g''1/);
  // As the voice wants: the switches go.
  M.setStem(score, 0, 0, 4, 0);
  assert.doesNotMatch(stable(score), /\\stem/);
});

test("stems: kept through notes written over them and an edit elsewhere", () => {
  const score = read("{ c''4 \\stemDown d'' e'' \\stemNeutral f'' | g''1 }");
  M.write(score, 0, q, q, { rest: false, pitches: [{ d: 20, alter: 0 }] });
  M.write(score, 0, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 14, alter: 0 }] });
  assert.match(stable(score), /c''4 \\stemDown b''4 e''4 \\stemNeutral f''4 \| c''4/);
});

test("stems: what is refused — no such direction, a line of chord names, no such note", () => {
  const score = read("<< \\new ChordNames \\chordmode { c1 } \\new Staff { c''1 } >>");
  const before = M.toLilyPond(score).source;
  assert.throws(() => M.setStem(score, 1, 0, 0, 2), /up, down/);
  assert.throws(() => M.setStem(score, 0, 0, 0, 1), /chord symbols, not notes/);
  assert.throws(() => M.setStem(score, 1, 0, 5, 1), /no such note/);
  assert.equal(M.toLilyPond(score).source, before);
});

// ---- Beams by hand --------------------------------------------------------------

test("beams: the selection beamed by hand, again to take it away; one across a bar refused", () => {
  const score = read(EIGHTHS);
  M.toggleBeam(score, 0, 1, 3);
  assert.deepEqual(M.handBeamAt(score, 0, 2), [1, 3]);
  assert.match(stable(score), /c''8 d''8\[ e''8 f''8\] g''8/);
  M.toggleBeam(score, 0, 1, 3);
  assert.equal(M.handBeamAt(score, 0, 2), null);
  assert.doesNotMatch(stable(score), /\[/);
  assert.throws(() => M.toggleBeam(read("{ c''2. d''8 e'' | f''8 g'' a''2. }"), 0, 1, 3), /in its bar/);
  assert.throws(() => M.toggleBeam(score, 0, 2, 2), /two notes or more/);
  assert.throws(() => M.toggleBeam(read("{ c''4 d''8 e'' f''2 }"), 0, 0, 2), /eighths and shorter/);
  assert.throws(() => M.toggleBeam(read("{ c''8 d'' r e'' f''2 }"), 0, 0, 2), /starts and ends on a note/);
});

test("beams: two beams joined, one broken in two; a part of one note is left unbeamed", () => {
  const score = read("{ c''8[ d''] e''[ f''] g''[ a'' b'' c'''] | c''1 }");
  M.toggleBeam(score, 0, 1, 2);
  assert.deepEqual(M.handBeamAt(score, 0, 0), [0, 3], "the beams it reached into, joined");
  assert.match(stable(score), /c''8\[ d''8 e''8 f''8\] g''8\[/);
  M.breakBeam(score, 0, 2);
  assert.match(stable(score), /c''8\[ d''8\] e''8\[ f''8\]/);
  M.breakBeam(score, 0, 7);
  assert.match(stable(score), /g''8\[ a''8 b''8\] c'''8 \|/, "the last note alone: no beam");
  assert.throws(() => M.breakBeam(score, 0, 4), /starts on this note/);
  assert.throws(() => M.breakBeam(score, 0, 7), /engraver's own/);
});

test("beams: kept through an edit elsewhere; one an edit breaks is left out, never half written", () => {
  const score = read("{ c''8[ d'' e'' f''] g''2 | c''1 }");
  M.write(score, 0, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 14, alter: 0 }] });
  assert.match(stable(score), /c''8\[ d''8 e''8 f''8\] g''2 \| c''4/);
  M.setDuration(score, 0, 1, 4, 0);
  assert.doesNotMatch(stable(score), /\[|\]/);
});

// ---- Enharmonic spelling ----------------------------------------------------------

test("enharmonic: C♯ and D♭ the other way, E to F♭ and back, a chord's head, tied notes with it", () => {
  assert.deepEqual(M.respell({ d: 7, alter: 1 }), { d: 8, alter: -1 });
  assert.deepEqual(M.respell({ d: 8, alter: -1 }), { d: 7, alter: 1 });
  assert.deepEqual(M.respell({ d: 9, alter: 0 }), { d: 10, alter: -1 });
  assert.deepEqual(M.respell({ d: 10, alter: -1 }), { d: 9, alter: 0 });
  const score = read("{ cis''4 des'' <e' gis'>2~ | <e' gis'>1 }");
  M.enharmonic(score, 0, 0, 1);
  assert.match(stable(score), /^\s*des''4 cis''4/m);
  M.enharmonic(score, 0, 2, 2, 1);
  assert.match(stable(score), /<e' as'>2~ \| <e' as'>1/, "the head selected, and the note tied to it");
  // Every head of the chord, when none is selected.
  M.enharmonic(score, 0, 2, 3);
  assert.match(stable(score), /<fes' gis'>2~ \| <fes' gis'>1/);
  // Same sound: Play is unchanged.
  assert.equal(M.midiKey(score.staves[0].events[2].pitches[0].d, score.staves[0].events[2].pitches[0].alter), 64);
});

test("enharmonic: refused on rests alone, a drum staff, a line of chord names", () => {
  assert.throws(() => M.enharmonic(read("{ r1 }"), 0, 0, 0), /select the notes/);
  assert.throws(() => M.enharmonic(read("\\new DrumStaff \\drummode { sn1 }"), 0, 0, 0), /drum staff/);
  assert.throws(() => M.enharmonic(read("<< \\new ChordNames \\chordmode { c1 } \\new Staff { c''1 } >>"), 0, 0, 0), /chord symbols/);
});

// ---- Merge and MusicXML -----------------------------------------------------------

test("merge: two people editing different bars keep each other's stems, beams and spellings", () => {
  const base = M.toLilyPond(read("{ c''8 d'' e'' f'' g''2 | cis''4 d'' e'' f'' | g''1 }")).source;
  const mine = read(base);
  M.toggleBeam(mine, 0, 0, 3);
  M.setStem(mine, 0, 1, 2, -1);
  const theirs = read(base);
  M.enharmonic(theirs, 0, 5, 5);
  const out = mergeScores(base, M.toLilyPond(mine).source, M.toLilyPond(theirs).source, { parse: score_json });
  assert.deepEqual(out.conflicts, []);
  assert.match(out.text, /c''8\[ \\stemDown d''8 e''8 \\stemNeutral f''8\] g''2 \| des''4/);
});

test("musicxml: hand beams and turned stems go out; spellings come back as they were", () => {
  const score = read("{ \\stemDown c''8[ d''] \\stemNeutral e'' f'' des''2 | cis''1 }");
  const xml = X.toMusicXML(score);
  assert.match(xml, /<step>C<\/step><octave>5<\/octave><\/pitch><duration>\d+<\/duration><voice>1<\/voice><type>eighth<\/type><stem>down<\/stem><beam number="1">begin<\/beam>/);
  assert.equal((xml.match(/<stem>/g) ?? []).length, 2, "only where turned");
  const back = read(X.fromMusicXML(xml).source);
  assert.deepEqual(M.handBeamAt(back, 0, 0), [0, 1]);
  assert.deepEqual(back.staves[0].events.slice(4).map((ev) => ev.pitches[0]), [{ d: 15, alter: -1 }, { d: 14, alter: 1 }]);
});
