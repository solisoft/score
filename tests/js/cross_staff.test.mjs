// Notes drawn on the other staff (\change Staff) and words sung to a lower
// voice (\new Lyrics \lyricsto "alto"), #375 slice 1: each is read from a
// text, kept through an edit made elsewhere, written back where it was, set
// and taken away from the editor, merged when two people edit other bars,
// and carried by MusicXML both ways.
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

/** The score engraved: its LilyPond, which the engraver draws, every drawn item a box. */
function engrave(score) {
  const { source, items } = M.toLilyPond(score);
  const view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  const drawn = items.filter((it) => !score.staves[it.staff].events[it.index].spacer);
  assert.equal(view.items.length, drawn.length, `the engraver sees every drawn item\n${source}`);
  return source;
}

/** Written, read back, written again: the same text. */
function stable(score) {
  const source = engrave(score);
  assert.equal(M.toLilyPond(read(source)).source, source, "read back, it writes itself again");
  return source;
}

const PIANO = '\\new PianoStaff << \\new Staff = "up" { c\'\'4 d\'\' \\change Staff = "down" g4 a \\change Staff = "up" | e\'\'1 } \\new Staff = "down" { \\clef bass c2 s2 | c1 } >>';

// ---- Notes on the other staff ----------------------------------------------------

test("kept: notes drawn on the other staff, read, written back, kept through an edit elsewhere", () => {
  const score = read(PIANO);
  assert.deepEqual(score.staves[0].events.map((ev) => ev.cross ?? null), [null, null, "down", "down", null]);
  assert.equal(score.staves[0].id, "up");
  assert.equal(score.staves[1].id, "down");
  M.write(score, 1, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 2, alter: 0 }] });
  const source = stable(score);
  assert.match(source, /\\new Staff = "up"/);
  assert.match(source, /d''4 \\change Staff = "down" g4 a4 \\change Staff = "up" \| e''1/);
  // Each bar starts on its own staff: one crossing on into the next bar says so again.
  const long = read('\\new PianoStaff << \\new Staff = "up" { c\'\'2 \\change Staff = "down" g2 | a1 } \\new Staff = "down" { \\clef bass s1 | s1 } >>');
  assert.match(stable(long), /\\change Staff = "down" g2 \\change Staff = "up" \| \\change Staff = "down" a1 \\change Staff = "up"/);
});

test("kept: a staff with no name of its own crossing to a named one is given one to come back to", () => {
  const score = read('\\new PianoStaff << \\new Staff { c\'\'2 \\change Staff = "down" g2 } \\new Staff = "down" { \\clef bass s1 } >>');
  assert.equal(score.staves[0].id, "up");
  assert.match(stable(score), /\\new Staff = "up"[\s\S]*c''2 \\change Staff = "down" g2 \\change Staff = "up"/);
});

test("cross: notes set on the staff below and above, again to bring them back; rests stay", () => {
  const score = M.fromTemplate("piano", { bars: 2 });
  for (const [k, d] of [[0, 14], [1, 2], [2, 3]]) M.write(score, 0, k * q, q, { rest: false, pitches: [{ d, alter: 0 }] });
  M.setCross(score, 0, 1, 3, 1);
  assert.equal(score.staves[0].id, "up");
  assert.equal(score.staves[1].id, "down");
  assert.deepEqual(score.staves[0].events.slice(0, 4).map((ev) => ev.cross ?? null), [null, "down", "down", null], "the rest after them stays");
  const source = stable(score);
  assert.match(source, /c''4 \\change Staff = "down" e4 f4 \\change Staff = "up" r4/);
  // Again: back on their own staff.
  M.setCross(score, 0, 1, 2, 1);
  assert.ok(score.staves[0].events.every((ev) => ev.cross == null));
  assert.doesNotMatch(stable(score), /\\change Staff/);
  // The lower staff's notes go up the same way.
  M.write(score, 1, 0, q, { rest: false, pitches: [{ d: 3, alter: 0 }] });
  M.setCross(score, 1, 0, 0, -1);
  assert.equal(score.staves[1].events[0].cross, "up");
  assert.match(stable(score), /\\change Staff = "up" f4 \\change Staff = "down"/);
});

test("cross: what is refused — no staff there, only rests, a drum staff", () => {
  const score = M.fromTemplate("piano", { bars: 1 });
  M.write(score, 0, 0, q, { rest: false, pitches: [{ d: 14, alter: 0 }] });
  assert.throws(() => M.setCross(score, 0, 0, 0, -1), /no staff above/);
  assert.throws(() => M.setCross(score, 1, 0, 0, 1), /no staff below/);
  assert.throws(() => M.setCross(score, 0, 1, 1, 1), /select the notes/);
  const band = M.fromTemplate("band", { bars: 1 });
  M.write(band, 2, 0, q, { rest: false, pitches: [{ d: 0, alter: 0 }] });
  assert.throws(() => M.setCross(band, 2, 0, 0, 1), /drum staff/);
  assert.ok(band.staves[2].events.every((ev) => ev.cross == null), "nothing written");
});

test("cross: a note made a rest, its staff taken away, or pasted where there is no such staff, crosses no more", () => {
  const score = read(PIANO);
  M.remove(score, 0, 2);
  assert.equal(score.staves[0].events[2].cross, undefined);
  // The staff it goes to taken away: back on its own.
  const other = read(PIANO);
  M.removeStaff(other, 1);
  assert.ok(other.staves[0].events.every((ev) => ev.cross == null));
  assert.doesNotMatch(stable(other), /\\change Staff/);
  // Copied to a score with one staff: written as a plain note.
  const clip = M.copy(read(PIANO), 0, 2, 3);
  const solo = M.newScore();
  M.paste(solo, 0, 0, clip);
  assert.equal(solo.staves[0].events[0].cross, "down", "it keeps where it was going");
  assert.doesNotMatch(engrave(solo), /\\change Staff/, "but the score has no such staff");
});

test("merge: two people editing different bars keep the notes on the other staff", () => {
  const base = M.toLilyPond(read(PIANO)).source;
  const mine = read(base);
  M.setCross(mine, 0, 0, 0, 1);
  const theirs = read(base);
  M.write(theirs, 0, M.barStart(theirs, 1), q, { rest: false, pitches: [{ d: 15, alter: 0 }] });
  const out = mergeScores(base, M.toLilyPond(mine).source, M.toLilyPond(theirs).source, { parse: score_json });
  assert.deepEqual(out.conflicts, []);
  const merged = read(out.text);
  assert.deepEqual(merged.staves[0].events.slice(0, 4).map((ev) => ev.cross ?? null), ["down", null, "down", "down"]);
  assert.equal(merged.staves[0].events[4].pitches[0].d, 15);
});

test("musicxml: a note on the other staff of a piano goes out on that <staff>, and comes back crossing", () => {
  const score = read(PIANO);
  const xml = X.toMusicXML(score);
  assert.match(xml, /<staves>2<\/staves>/, "a piano is one part");
  assert.match(xml, /<step>G<\/step><octave>3<\/octave><\/pitch><duration>\d+<\/duration><voice>1<\/voice><type>quarter<\/type><staff>2<\/staff>/);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.equal(M.toLilyPond(read(source)).source, M.toLilyPond(score).source);
  // A file that numbers both staves' voices 1 is two staves of their own, not a crossing.
  const both = read(X.fromMusicXML(xml.replace(/<voice>5<\/voice>/g, "<voice>1</voice>")).source);
  assert.deepEqual(both.staves[1].events.filter((ev) => !ev.rest).map((ev) => [ev.pitches[0].d, ev.cross ?? null]), [[0, null], [0, null]]);
});

// ---- Words under a lower voice ---------------------------------------------------

const SATB = `\\new ChoirStaff <<
  \\new Staff = "women" << \\new Voice = "soprano" { \\voiceOne c''4 d'' e''2 | f''1 } \\new Voice = "alto" { \\voiceTwo a'4 b' c''2 | c''1 } >>
  \\new Lyrics \\lyricsto "alto" { Al -- le -- lu ia }
  \\new Staff = "men" << \\clef bass \\new Voice = "tenor" { \\voiceOne c'2 d' | e'1 } \\new Voice = "bass" { \\voiceTwo c2 g, | c1 } >>
>>`;

test("kept: words sung to the second voice, under its notes, the voice's name with them", () => {
  const score = read(SATB);
  assert.equal(score.staves[0].lyricsVoice, 2);
  assert.equal(score.staves[0].lyricsName, "alto");
  assert.equal(M.lyricsLane(score, 0), 1);
  assert.deepEqual(score.staves[1].events.map((ev) => ev.lyric?.text ?? null), ["Al", "le", "lu", "ia"]);
  assert.ok(score.staves[0].events.every((ev) => !ev.lyric), "none under the soprano");
  M.write(score, 0, M.barStart(score, 1), q, { rest: false, pitches: [{ d: 16, alter: 0 }] });
  const source = stable(score);
  assert.match(source, /<< \{ \\voiceOne c''4 d''4 e''2 \| e''4 f''2. \}\n\s*\\new Voice = "alto" \{ \\voiceTwo a'4 b'4 c''2 \| c''1 \} >>/);
  assert.match(source, /\\new Lyrics \\lyricsto "alto" \{ Al -- le -- lu ia \}/);
  // A staff whose words go to its first voice is written as it was.
  assert.match(source, /\\new Staff = "men"[\s\S]*<< \{ c'2 d'2 \} \\\\ \{ c2 g,2 \} >>/);
});

test("lyrics: typed under a second voice, the staff sings to it; refused under another voice while it has words", () => {
  const score = M.fromTemplate("blank", { bars: 1 });
  const lane = M.addVoice(score, 0);
  M.write(score, 0, 0, M.notated(1), { rest: false, pitches: [{ d: 16, alter: 0 }] });
  M.write(score, lane, 0, M.notated(2), { rest: false, pitches: [{ d: 9, alter: 0 }] });
  M.write(score, lane, M.notated(2), M.notated(2), { rest: false, pitches: [{ d: 10, alter: 0 }] });
  M.setLyric(score, lane, 0, "Ky", true);
  M.setLyric(score, lane, 1, "rie");
  assert.equal(M.lyricsVoiceOf(score, 0), 2);
  const source = stable(score);
  assert.match(source, /^<<\n/m, "one staff and its Lyrics line, side by side");
  assert.match(source, /\\new Voice = "staff1voice2" \{ \\voiceTwo e'2 f'2 \}/);
  assert.match(source, /\\new Lyrics \\lyricsto "staff1voice2" \{ Ky -- rie \}/);
  // Under the first voice now: refused, nothing written.
  assert.throws(() => M.setLyric(score, 0, 0, "la"), /voice 2/);
  assert.equal(score.staves[0].events[0].lyric, null);
  // A second verse goes to the same voice.
  M.setLyric(score, lane, 0, "Glo", false, false, 2);
  assert.match(stable(score), /\\new Lyrics \\lyricsto "staff1voice2" \{ Glo \}/);
  // Every word taken away: the staff sings to its first voice again.
  M.setLyric(score, lane, 0, "", false, false, 2);
  M.setLyric(score, lane, 0, "");
  M.setLyric(score, lane, 1, "");
  assert.equal(M.lyricsVoiceOf(score, 0), 1);
  assert.equal(score.staves[0].lyricsVoice, undefined);
  M.setLyric(score, 0, 0, "la");
  assert.match(stable(score), /\\addlyrics \{ la \}/);
});

test("lyrics: the voice taken away takes its words with it", () => {
  const score = read(SATB);
  M.removeVoice(score, 0, 2);
  assert.equal(M.lyricsVoiceOf(score, 0), 1);
  assert.doesNotMatch(stable(score), /Lyrics|lyricsto/);
});

test("merge: two people editing different bars keep the words under the alto", () => {
  const base = M.toLilyPond(read(SATB)).source;
  const mine = read(base);
  M.setLyric(mine, 1, 3, "ja");
  const theirs = read(base);
  M.write(theirs, 2, 0, M.notated(2), { rest: false, pitches: [{ d: 9, alter: 0 }] });
  const out = mergeScores(base, M.toLilyPond(mine).source, M.toLilyPond(theirs).source, { parse: score_json });
  assert.deepEqual(out.conflicts, []);
  const merged = read(out.text);
  assert.equal(merged.staves[1].events[3].lyric.text, "ja");
  assert.equal(merged.staves[0].lyricsName, "alto");
  assert.equal(merged.staves[2].events[0].pitches[0].d, 9);
});

test("musicxml: words under the second voice go out on its notes and come back under it", () => {
  const score = read(SATB);
  const xml = X.toMusicXML(score);
  assert.match(xml, /<voice>2<\/voice>.*<lyric number="1"><syllabic>begin<\/syllabic><text>Al<\/text>/s);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  const back = read(source);
  assert.equal(back.staves[0].lyricsVoice, 2);
  assert.deepEqual(back.staves[1].events.map((ev) => ev.lyric?.text ?? null), ["Al", "le", "lu", "ia"]);
  // The same score but the names of the voice and the staves, which MusicXML does not carry.
  const named = (s) => M.toLilyPond({ ...s, staves: s.staves.map((st) => ({ ...st, lyricsName: undefined, id: undefined })) }).source;
  assert.equal(named(back), named(score));
});
