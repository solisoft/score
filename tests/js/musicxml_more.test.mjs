// What the changelog's samples (#415) found the editor dropping on the way
// through MusicXML, and when it lights a note: each kept now.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";
import { onsetSeconds } from "./midi_onsets.mjs";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (src) => {
  const result = M.fromParsed(JSON.parse(score_json(src)));
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result.score;
};

/** Out to MusicXML and back: the same text, nothing left out. */
function through(src) {
  const score = read(src);
  const xml = X.toMusicXML(score);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  const back = read(source);
  assert.equal(M.toLilyPond(back).source, M.toLilyPond(score).source);
  return { score, xml, back };
}

test("musicxml: a piano's voice drawn on the other staff from its first note stays its own staff's (voices 1–4 the first's, 5–8 the second's)", () => {
  const { xml, back } = through("\\new PianoStaff \\autoChange \\relative c' { g4 a b c | d c b a | c,1 }");
  // Its first note is written on the second staff, in voice 1.
  assert.match(xml, /<step>G<\/step><octave>3<\/octave><\/pitch><duration>\d+<\/duration><voice>1<\/voice><type>quarter<\/type><staff>2<\/staff>/);
  assert.match(M.toLilyPond(back).source, /\\new Staff = "up" \{\n {4}\\clef treble \\key c \\major \\time 4\/4\n {4}\\change Staff = "down" g4/);
  // A file whose voices are not numbered by staff still takes a voice's staff from its first note.
  const plain = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>2</staff></note></measure></part></score-partwise>`;
  assert.match(X.fromMusicXML(plain).source, /\\new Staff \{ \\time 4\/4 \\clef treble r1 \}\n {2}\\new Staff \{ \\time 4\/4 \\clef bass c1 \}/);
});

test("musicxml: a tablature goes out on MusicXML's TAB clef and six lines, and comes back a TabStaff", () => {
  const { xml, back } = through("<< \\new Staff { c'4 e' g' c'' } \\new TabStaff { c'4 e' g' c'' } >>");
  assert.match(xml, /<clef><sign>TAB<\/sign><line>5<\/line><\/clef><staff-details><staff-lines>6<\/staff-lines><\/staff-details>/);
  assert.ok(back.staves[1].tab);
});

test("musicxml: stems turned by hand come back in a file this editor wrote, not from another program's", () => {
  const { xml, back } = through("{ \\stemDown c''8[ d''] \\stemNeutral e''[ f''] g''2 }");
  assert.match(xml, /<stem>down<\/stem>/);
  assert.equal(back.staves[0].events[0].stemDir, -1);
  // Another program's <stem> on every note is how it drew them: no \\stemDown.
  const theirs = xml.replace("<software>eui-score</software>", "<software>MuseScore 4</software>");
  assert.doesNotMatch(X.fromMusicXML(theirs).source, /\\stemDown/);
});

test("musicxml: a \\time inside a bar and a bar \\partial makes keep their places; the page and a voice's name come along", () => {
  const { xml } = through("<< \\new Staff { c'4 d' \\time 3/4 e' | f' g' a' | \\time 2/4 \\partial 4 b'4 | c''2 } \\new Staff { c4 d e | f g a | b4 | c'2 } >>");
  // The \\time where it is written, inside the first measure; the short measure implicit.
  assert.match(xml, /<step>D<\/step>.*?<\/note>\n<attributes><time><beats>3<\/beats><beat-type>4<\/beat-type><\/time><\/attributes>/s);
  assert.match(xml, /<measure number="3" implicit="yes">/);
  const paged = through("\\paper { indent = 10\\mm left-margin = 15\\mm } { c'1 }");
  assert.match(paged.xml, /<miscellaneous-field name="lilypond-page">\\paper \{ left-margin = 15\\mm indent = 10\\mm \}<\/miscellaneous-field>/);
  assert.match(paged.xml, /<defaults><scaling><millimeters>7\.056<\/millimeters><tenths>40<\/tenths><\/scaling><page-layout><page-height>1683\.78<\/page-height>/);
  assert.equal(paged.back.paper.indent, 10);
  const sung = through('<< \\new Staff << \\new Voice { \\voiceOne e\'\'2 d\'\' } \\new Voice = "alto" { \\voiceTwo c\'\'2 b\' } >> \\new Lyrics \\lyricsto "alto" { Al -- le } >>');
  assert.match(sung.xml, /<lyric number="1" name="alto">/);
  assert.equal(sung.back.staves[0].lyricsName, "alto");
});

test("a rehearsal mark the engraver draws in a box is the editor's letter mark, not words with its style", () => {
  const score = read("{ \\set Score.rehearsalMarkFormatter = #format-mark-box-letters \\mark \\default c'1 | \\mark \\default d'1 }");
  assert.deepEqual(score.changes.filter((c) => c.mark).map((c) => c.mark), ["letter", "letter"]);
  assert.doesNotMatch(M.toLilyPond(score).source, /\\u0001|box\|/);
});

test("playing: a note with grace notes after it, or a trill, is lit while the MIDI strikes it again", () => {
  const s = read("\\relative c'' { \\afterGrace c2~ { b16 c } c4 d | \\afterGrace e1\\trill { d16 e } | c1 }");
  const passes = M.playback(s);
  const at = M.starts(s.staves[0]);
  // The half note at 100 a quarter: lit from 0 to its end, its grace notes at 0.9 and 1.05 s inside.
  assert.deepEqual(M.heardUntil(s, passes, 0, 0, at[0]).map((x) => +x.toFixed(6)), [1.2]);
  assert.deepEqual(M.heardUntil(s, passes, 0, 3, at[3]).map((x) => +x.toFixed(6)), [4.8]);
  // A plain note: as heardAt.
  assert.deepEqual(M.heardUntil(s, passes, 0, 2, at[2]), M.heardAt(s, passes, 0, 2, at[2]));
  const onsets = onsetSeconds(midi(M.toLilyPond(s, { unfold: true }).source, 100, 4, 0));
  assert.ok(onsets.some((h) => Math.abs(h - 0.9) < 1e-3) && onsets.filter((h) => h > 2.4 && h < 4.8).length > 10, `${onsets}`);
});
