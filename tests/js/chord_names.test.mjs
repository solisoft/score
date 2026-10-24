// A line of chord names (\new ChordNames \chordmode), #375 slice 2: read from
// a text, kept through an edit elsewhere and written back as it was written,
// its chords typed beat by beat and taken away, transposed, merged when two
// people edit other bars, and sent to MusicXML as chord symbols.
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
  // What is not notation, as the editor reads it with the score.
  result.score.meta = M.readMeta(src);
  return result.score;
}

function stable(score) {
  const { source, items } = M.toLilyPond(score);
  const view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  assert.equal(view.items.length, items.filter((it) => M.isDrawn(score, it)).length, `the engraver sees every drawn item\n${source}`);
  assert.equal(M.toLilyPond(read(source)).source, source, "read back, it writes itself again");
  return source;
}

const chordsOf = (score, s = 0) => score.staves[s].events.map((ev) => ev.chord || "·");

const LEAD = `<<
  \\new ChordNames \\chordmode { c2:m7 f:7 | bes1:maj7 | r2 g:7/b | c:9^7 s }
  \\new Staff { \\time 4/4 c''1 | d''1 | e''1 | f''1 }
>>`;

test("chord symbols: typed as people write them, written as \\chordmode writes them, and back", () => {
  const pairs = [
    ["C", "c"], ["Am", "a:m"], ["Am7", "a:m7"], ["F7", "f:7"], ["Bbmaj7", "bes:maj7"], ["BbΔ7", "bes:maj7"], ["G7/B", "g:7/b"],
    ["Dm7b5", "d:m7.5-"], ["Dø", "d:m7.5-"], ["Csus4", "c:sus4"], ["C7sus4", "c:sus4.7"], ["C7b9", "c:7.9-"], ["C7#9#11", "c:7.9+.11+"],
    ["C6/9", "c:6.9"], ["Cadd9", "c:5.9"], ["Cm(maj7)", "c:m7+"], ["F#dim7", "fis:dim7"], ["Ebaug", "es:aug"], ["C5", "c:1.5"],
  ];
  for (const [symbol, written] of pairs) assert.equal(M.chordmodeOf(symbol), written, symbol);
  for (const [symbol, written] of pairs.filter(([s]) => !/Δ|ø/.test(s))) assert.equal(M.symbolOfChordmode(written), symbol, written);
  assert.equal(M.symbolOfChordmode("bes2.:maj7"), "Bbmaj7", "the duration left out");
  for (const bad of ["H7", "Cxyz", "", "do"]) assert.throws(() => M.chordmodeOf(bad), /not a chord the line of chord names can write/, bad);
});

test("kept: a line of chord names, each chord as it was written, through an edit elsewhere", () => {
  const score = read(LEAD);
  assert.equal(score.staves[0].chords, true);
  assert.deepEqual(chordsOf(score), ["Cm7", "F7", "Bbmaj7", "N.C.", "G7/B", "C9", "·"]);
  assert.equal(score.staves[0].events[5].chordmode, "c:9^7", "what the symbol does not say, kept");
  M.write(score, 1, M.barStart(score, 3), q, { rest: false, pitches: [{ d: 16, alter: 0 }] });
  const source = stable(score);
  assert.match(source, /\\new ChordNames \\chordmode \{\n\s*c2:m7 f2:7 \| bes1:maj7 \| r2 g2:7\/b \| c2:9\^7 s2\n\s*\}/);
  // The metre is the music's: a line in 3/4 says none of its own.
  const waltz = read("<< \\new ChordNames \\chordmode { c2. g2.:7 } \\new Staff { \\time 3/4 c'2. | d'2. } >>");
  assert.deepEqual(waltz.time, [3, 4]);
  assert.deepEqual(chordsOf(waltz), ["C", "G7"]);
  // A chord over a bar line is named once, at its start.
  const long = read("<< \\new ChordNames \\chordmode { c1.:m7 g2 } \\new Staff { c'1 | d'1 } >>");
  assert.deepEqual(chordsOf(long), ["Cm7", "·", "G"]);
  assert.match(stable(long), /c1:m7 \| s2 g2/);
});

test("chord line: chords typed beat by beat, changed, and taken away", () => {
  const score = M.fromTemplate("lead-sheet", { bars: 2 });
  const line = M.addChordStaff(score, 0);
  assert.equal(line, 0);
  assert.equal(M.chordLineOver(score, 1), 0, "over the melody");
  assert.equal(M.chordLineOver(score, 0), 0);
  M.setChordAt(score, 0, 0, "Am7");
  M.setChordAt(score, 0, M.nextBeat(score, 0) * 2, "D7");
  M.setChordAt(score, 0, M.barStart(score, 1), "Gmaj7");
  assert.equal(M.nextBeat(score, 0), q);
  assert.match(stable(score), /\\chordmode \{\n\s*a2:m7 d2:7 \| g1:maj7\n/);
  // Changed: its spelling is the new symbol's.
  M.setChordAt(score, 0, 0, "Am9");
  assert.match(stable(score), /a2:m9 d2:7/);
  // No chord said: N.C.
  M.setChordAt(score, 0, M.barStart(score, 1), "nc");
  assert.match(stable(score), /\| r1/);
  // Taken away: the beats go back to nothing, written as one.
  M.setChordAt(score, 0, 2 * q, "");
  assert.match(stable(score), /a2:m9 s2 \| r1/);
});

test("chord line: what is refused — a chord it cannot write, notes, a beat past the end", () => {
  const score = read(LEAD);
  const before = M.toLilyPond(score).source;
  assert.throws(() => M.setChordAt(score, 0, 0, "Hmaj7"), /not a chord/);
  assert.throws(() => M.setChordSymbol(score, 0, 0, "blue"), /not a chord/);
  assert.throws(() => M.setChordAt(score, 0, M.barStart(score, 4), "C"), /no beat there/);
  assert.throws(() => M.setChordAt(score, 1, 0, "C"), /not a line of chord names/);
  assert.throws(() => M.letter(score, 0, 0, 2), /holds chord symbols, not notes/);
  assert.throws(() => M.write(score, 0, 0, q, { rest: false, pitches: [{ d: 7, alter: 0 }] }), /holds chord symbols/);
  assert.throws(() => M.addChordStaff(score, 0), /already/);
  assert.equal(M.toLilyPond(score).source, before, "nothing changed");
});

test("chord line: transposed with the score, the source's spelling with it", () => {
  const score = read(LEAD);
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.deepEqual(chordsOf(score).slice(0, 5), ["Dm7", "G7", "Cmaj7", "N.C.", "A7/C#"]);
  assert.match(stable(score), /d2:m7 g2:7 \| c1:maj7 \| r2 a2:7\/cis \| d2:9\^7/);
});

test("chord line: added over a staff, the groups and what is kept by lane follow", () => {
  const score = M.fromTemplate("voice-piano", { bars: 1 });
  score.meta = { velocity: { "1:0:60": 90 }, mixer: { tracks: { 2: { volume: 0.5 } } } };
  const line = M.addChordStaff(score, 1);
  assert.equal(line, 1);
  assert.deepEqual([score.groups[0].first, score.groups[0].last], [2, 3]);
  assert.deepEqual(score.meta.velocity, { "2:0:60": 90 });
  assert.deepEqual(Object.keys(score.meta.mixer.tracks), ["3"]);
  stable(score);
  // Taken away again: back as they were.
  M.removeStaff(score, line);
  assert.deepEqual(score.meta.velocity, { "1:0:60": 90 });
  assert.deepEqual(score.groups[0].first, 1);
});

test("merge: two people editing different bars keep the line of chord names and its chords", () => {
  const base = M.toLilyPond(read(LEAD)).source;
  const mine = read(base);
  M.setChordAt(mine, 0, M.barStart(mine, 1), "Ebmaj7");
  const theirs = read(base);
  M.write(theirs, 1, 0, q, { rest: false, pitches: [{ d: 15, alter: 0 }] });
  const out = mergeScores(base, M.toLilyPond(mine).source, M.toLilyPond(theirs).source, { parse: score_json });
  assert.deepEqual(out.conflicts, []);
  const merged = read(out.text);
  assert.equal(merged.staves[0].chords, true);
  assert.deepEqual(chordsOf(merged).slice(0, 3), ["Cm7", "F7", "Ebmaj7"]);
  assert.equal(merged.staves[0].events[5].chordmode, "c:9^7");
  assert.equal(merged.staves[1].events[0].pitches[0].d, 15);
  // The same bar's chord changed two ways: a conflict.
  const other = read(base);
  M.setChordAt(other, 0, M.barStart(other, 1), "Bb7");
  assert.equal(mergeScores(base, M.toLilyPond(mine).source, M.toLilyPond(other).source, { parse: score_json }).conflicts.length, 1);
});

test("musicxml: the chords go out as chord symbols of the part under them, each at its time, and come back over its notes", () => {
  const score = read(LEAD);
  const xml = X.toMusicXML(score);
  assert.equal((xml.match(/<score-part /g) ?? []).length, 1, "no part of its own");
  assert.match(xml, /<harmony><root><root-step>F<\/root-step><\/root><kind text="7">dominant<\/kind><offset>2<\/offset><\/harmony>/);
  assert.match(xml, /<words>N\.C\.<\/words><\/direction-type><\/direction>/);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  const back = read(source);
  assert.deepEqual(back.staves[0].events.map((ev) => ev.chord), ["Cm7", "Bbmaj7", "G7/B", "C9"]);
  assert.deepEqual(back.staves[0].events.map((ev) => ev.texts.map((t) => t.text)), [["F7"], [], ["N.C."], []], "a chord later in a bar, on the note sounding then");
});
