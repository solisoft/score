// Notation the engraver drew and the editor could not keep (#373): ottava
// lines, fingerings and string numbers, phrasing slurs. Each is read from a
// text, kept through an edit made elsewhere, written back where it was, and
// set or taken away from the editor; played as written; and carried by
// MusicXML both ways.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";

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
  const drawn = items.filter((it) => M.isDrawn(score, it));
  assert.equal(view.items.length, drawn.length, `the engraver sees every drawn item\n${source}`);
  return source;
}

/** Read, edited away from the element (a note written in the last bar), written back. */
function editedElsewhere(src) {
  const { score, lost } = read(src);
  M.write(score, 0, M.barStart(score, M.barsOf(score) - 1), q, A4);
  return { score, lost, source: engrave(score) };
}

// ---- Ottava lines ----------------------------------------------------------------

test("kept: an ottava line, where it starts and where it ends", () => {
  const { score, lost, source } = editedElsewhere("{ \\ottava #1 c'''4 d''' e''' f''' | \\ottava #0 c'1 | \\ottava #-1 c,2 \\ottava #0 c2 | d'1 }");
  assert.equal(lost, undefined);
  assert.match(source, /\\ottava #1 c'''4 d'''4 e'''4 f'''4 \| \\ottava #0 c'1 \| \\ottava #-1 c,2 \\ottava #0 c2/);
  assert.equal(score.staves[0].events[0].ottava, 1);
  assert.equal(M.ottavaAt(score.staves[0], 3), 1);
  assert.equal(M.ottavaAt(score.staves[0], 4), 0);
  // 15ma, and an ottava starting on a whole bar of rest.
  assert.match(engrave(read("{ \\ottava #2 c''''1 | \\ottava #0 R1 }").score), /\\ottava #2 c''''1 \| \\ottava #0 r1/);
  assert.match(engrave(read("{ c'1 | \\ottava #1 R1 | c''''1 }").score), /\\ottava #1 r1 \| c''''1/);
  // Read back, it is where it was.
  assert.equal(read(source).score.staves[0].events[0].ottava, 1);
  // One with no note after it is named: the first edit leaves it out.
  assert.deepEqual(read("{ c'1 \\ottava #1 }").lost, ["an \\ottava after the last note"]);
});

test("kept: an ottava survives the notes written over it", () => {
  const { score } = read("{ c'4 \\ottava #1 c'''4 d'''4 \\ottava #0 e'4 | f'1 }");
  // Its first note written over: the line starts on the note written instead.
  M.write(score, 0, q, q, { rest: false, pitches: [{ d: 23, alter: 0 }] });
  assert.match(engrave(score), /c'4 \\ottava #1 e'''4 d'''4 \\ottava #0 e'4/);
  // A half note over both notes under it: the line still ends after it.
  M.write(score, 0, q, 2 * q, { rest: false, pitches: [{ d: 21, alter: 0 }] });
  assert.match(engrave(score), /c'4 \\ottava #1 c'''2 \\ottava #0 e'4/);
  // Its end written over: the line still ends there.
  M.write(score, 0, 3 * q, q, { rest: false, pitches: [{ d: 9, alter: 0 }] });
  assert.match(engrave(score), /\\ottava #1 c'''2 \\ottava #0 e'4 \|/);
  // Over the end and past it: the line ends where the written note starts.
  const over = read("{ \\ottava #1 c'''4 d'''4 \\ottava #0 e'4 f'4 }").score;
  M.write(over, 0, q, 2 * q, { rest: false, pitches: [{ d: 7, alter: 0 }] });
  assert.match(engrave(over), /\\ottava #1 c'''4 \\ottava #0 c'2 f'4/);
  // Cut in tied pieces, the line starts on the first.
  const long = read("{ c'2 \\ottava #1 c'''2 | \\ottava #0 c'1 }").score;
  M.setDuration(long, 0, 1, 1, 0);
  assert.match(engrave(long), /\\ottava #1 c'''2~ \| c'''2 \\ottava #0 c'2/);
});

test("ottava: 8va and 8vb over the selection, again to take it away, and an end", () => {
  const { score } = read("{ c''4 d'' e'' f'' | g''1 }");
  M.setOttava(score, 0, 1, 2, 1);
  assert.match(engrave(score), /c''4 \\ottava #1 d''4 e''4 \\ottava #0 f''4/);
  // Again over the same notes: gone.
  M.setOttava(score, 0, 2, 1, 1);
  assert.doesNotMatch(engrave(score), /ottava/);
  // To the end of the piece: no end written.
  M.setOttava(score, 0, 3, 4, -1);
  assert.match(engrave(score), /e''4 \\ottava #-1 f''4 \| g''1/);
  // Ended from a note on.
  M.endOttava(score, 0, 4);
  assert.match(engrave(score), /\\ottava #-1 f''4 \| \\ottava #0 g''1/);
  assert.throws(() => M.endOttava(score, 0, 0), /no ottava/);
  assert.throws(() => M.endOttava(score, 0, 9), /no such note/);
  // Inside an 8va, an 8vb over one note: the 8va goes on after it.
  const inside = read("{ \\ottava #1 c'''4 d''' e''' f''' }").score;
  M.setOttava(inside, 0, 1, 1, -1);
  assert.match(engrave(inside), /\\ottava #1 c'''4 \\ottava #-1 d'''4 \\ottava #1 e'''4 f'''4/);
  assert.throws(() => M.setOttava(inside, 0, 0, 0, 3), /8va/);
  assert.throws(() => M.setOttava(inside, 0, 9, 9, 1), /no such note/);
  assert.throws(() => M.setOttava(inside, 4, 0, 0, 1), /no such staff/);
  // Not in a second voice, not on drums.
  const two = read("{ << { c''1 } \\\\ { e'1 } >> }").score;
  assert.throws(() => M.setOttava(two, 1, 0, 0, 1), /first voice/);
  const drums = read("\\new DrumStaff \\drummode { bd4 sn bd sn }").score;
  assert.throws(() => M.setOttava(drums, 0, 0, 0, 1));
});

test("ottava: the notes sound as the text writes them, the line drawn or not", () => {
  const text = "{ c'''4 d''' e''' f''' | c'1 }";
  const plain = M.toLilyPond(read(text).score, { unfold: true }).source;
  const lined = read(text).score;
  M.setOttava(lined, 0, 0, 3, 1);
  const played = M.toLilyPond(lined, { unfold: true }).source;
  assert.match(played, /\\ottava #1/);
  assert.deepEqual(midi(played, 100, 4, 0), midi(plain, 100, 4, 0));
});

// ---- Fingerings and string numbers ------------------------------------------------

test("kept: fingerings, above, below and in a chord, and string numbers", () => {
  const { score, lost, source } = editedElsewhere("{ c'4-1 d'^2 e'_3 <c' e' g'>-1-3-5 | <c'\\5-1 e'-3 g'>2 a'4\\3 b'4-4\\2 | c''1 }");
  assert.equal(lost, undefined);
  assert.match(source, /c'4-1 d'4\^2 e'4_3 <c' e' g'>4-1-3-5 \| <c'\\5-1 e'-3 g'>2 a'4\\3 b'4-4\\2/);
  assert.deepEqual(score.staves[0].events[4].fingers, [
    { text: "5", dir: -1, head: 7, circled: true },
    { text: "1", dir: 0, head: 7, circled: false },
    { text: "3", dir: 0, head: 9, circled: false },
  ]);
  // Moved, a chord's fingering stays on its note; transposed too.
  M.move(score, 0, 4, "step", 1, 1);
  assert.match(engrave(score), /<c'\\5-1 f'-3 g'>2/);
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(engrave(score), /<d'\\5-1 g'-3 a'>2/);
  // A note of the chord taken away, its fingering with it.
  M.remove(score, 0, 4, 1);
  assert.match(engrave(score), /<d'\\5-1 a'>2/);
  // A note made a rest loses its fingers.
  M.remove(score, 0, 0);
  assert.equal(score.staves[0].events[0].fingers, undefined);
});

test("fingering: set on a note, on a chord's note, changed, taken away", () => {
  const { score } = read("{ c'4 <e' g'>4 a'2 }");
  M.setFingering(score, 0, 0, 2);
  assert.match(engrave(score), /c'4-2 /);
  // Another finger replaces it; the same again takes it away.
  M.setFingering(score, 0, 0, 3);
  assert.match(engrave(score), /c'4-3 /);
  M.setFingering(score, 0, 0, 3);
  assert.match(engrave(score), /c'4 /);
  // On each note of the chord; a string on a note.
  M.setFingering(score, 0, 1, 5, { head: 1 });
  M.setFingering(score, 0, 1, 1, { head: 0 });
  assert.match(engrave(score), /<e'-1 g'-5>4/);
  M.setFingering(score, 0, 2, 2, { circled: true });
  assert.match(engrave(score), /a'2\\2/);
  M.removeFingerings(score, 0, 1);
  assert.match(engrave(score), /<e' g'>4/);
  assert.throws(() => M.setFingering(score, 0, 0, 6), /1 to 5/);
  assert.throws(() => M.setFingering(score, 0, 0, 7, { circled: true }), /1 to 6/);
  M.remove(score, 0, 0);
  assert.throws(() => M.setFingering(score, 0, 0, 1), /select a note/);
  // Played as they were.
  const { score: fingered } = read("{ c'4-1 d'4\\2 <e' g'>2-3 }");
  assert.deepEqual(midi(M.toLilyPond(fingered).source, 100, 4, 0), midi("{ c'4 d'4 <e' g'>2 }", 100, 4, 0));
});

// ---- Phrasing slurs ---------------------------------------------------------------

test("kept: phrasing slurs, beside the slurs", () => {
  const { score, lost, source } = editedElsewhere("{ c'4\\( d'( e') f'\\) | g'4\\( a' b' c''\\) | d''1 }");
  assert.equal(lost, undefined);
  assert.match(source, /c'4\\\( d'4\( e'4\) f'4\\\) \| g'4\\\( a'4 b'4 c''4\\\)/);
  assert.equal(score.staves[0].events[0].phraseStart, true);
  assert.equal(score.staves[0].events[3].phraseEnd, true);
  // Taken away from one of its notes: both its ends go.
  M.togglePhrase(score, 0, 4, 4);
  assert.doesNotMatch(engrave(score), /g'4\\\(|c''4\\\)/);
  // Over a selection; on one note, to the next note.
  M.togglePhrase(score, 0, 4, 7);
  assert.match(engrave(score), /g'4\\\( a'4 b'4 c''4\\\)/);
  const one = read("{ c'4 d' e' f' }").score;
  M.togglePhrase(one, 0, 1, 1);
  assert.match(engrave(one), /d'4\\\( e'4\\\)/);
  assert.throws(() => M.togglePhrase(read("{ c'4 r2. }").score, 0, 0, 1), /phrasing slur/);
  // A note made a rest takes neither end.
  M.remove(one, 0, 1);
  assert.equal(one.staves[0].events[1].phraseStart, undefined);
  // A note cut in two: the phrase starts on its first piece and ends on its last.
  const cut = read("{ c'2\\( d'2\\) | e'1 }").score;
  M.setDuration(cut, 0, 1, 1, 0);
  assert.match(engrave(cut), /c'2\\\( d'2~ \| d'2\\\) e'2/);
});

// ---- MusicXML --------------------------------------------------------------------

test("musicxml: ottava lines, fingerings, strings and phrasing slurs go out and come back", () => {
  const { score } = read("{ \\ottava #1 c'''4-1\\( d'''^2 \\ottava #0 e'_3 <f'-1 a'-4> | \\ottava #-2 c,4\\3 d,( e,) f,\\) | \\ottava #0 c'1 }");
  const xml = X.toMusicXML(score);
  assert.match(xml, /<octave-shift type="down" size="8"\/>/);
  assert.match(xml, /<octave-shift type="stop" size="8"\/>/);
  assert.match(xml, /<octave-shift type="up" size="15"\/>/);
  assert.match(xml, /<octave-shift type="stop" size="15"\/>/);
  assert.match(xml, /<fingering placement="above">2<\/fingering>/);
  assert.match(xml, /<fingering placement="below">3<\/fingering>/);
  assert.match(xml, /<string>3<\/string>/);
  assert.match(xml, /<slur type="start" number="2"\/>/);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.equal(M.toLilyPond(read(source).score).source, M.toLilyPond(score).source);
});

test("musicxml: a second slur over the first is read as a phrasing slur", () => {
  const xml = X.toMusicXML(read("{ c'4( d' e' f') }").score)
    .replace('<slur type="start" number="1"/>', '<slur type="start" number="1"/><slur type="start" number="3"/>')
    .replace('<slur type="stop" number="1"/>', '<slur type="stop" number="3"/><slur type="stop" number="1"/>');
  const { source } = X.fromMusicXML(xml);
  assert.match(source, /c'4\(\\\( d'4 e'4 f'4\\\)\)/);
  engrave(read(source).score);
});

test("a slur over or under the notes (#467): read, kept, set, turned, taken away", () => {
  // Read back from a source with its sides, and written out the same.
  const { score, lost, source } = editedElsewhere("{ c'4^( d') e'_( f') | g'4( a') b'^\\( c''\\) | d''1 }");
  assert.equal(lost, undefined);
  assert.match(source, /c'4\^\( d'4\) e'4_\( f'4\) \| g'4\( a'4\) b'4\^\\\( c''4\\\)/);
  assert.equal(score.staves[0].events[0].slurDir, 1);
  assert.equal(score.staves[0].events[2].slurDir, -1);
  assert.equal(score.staves[0].events[4].slurDir, undefined, "( leaves it to the engraver");
  // Turned: under, then pressed again on its side, back to the engraver's choice.
  M.setSlurSide(score, 0, 4, 5, -1);
  assert.match(engrave(score), /g'4_\( a'4\)/);
  M.setSlurSide(score, 0, 5, 5, -1);
  assert.match(engrave(score), /g'4\( a'4\)/, "from its last note too");
  M.setSlurSide(score, 0, 0, 1, -1);
  assert.match(engrave(score), /c'4_\( d'4\)/, "over turned under");
  // None there: drawn on that side, over a selection or to the next note.
  const plain = read("{ c'4 d' e' f' }").score;
  M.setSlurSide(plain, 0, 0, 2, 1);
  assert.match(engrave(plain), /c'4\^\( d'4 e'4\)/);
  const single = read("{ c'4 d' e' f' }").score;
  M.setSlurSide(single, 0, 1, 1, -1);
  assert.match(engrave(single), /d'4_\( e'4\)/, "one note: to the next, on that side");
  assert.throws(() => M.setSlurSide(single, 0, 3, 3, 1), /later note/);
  assert.throws(() => M.setSlurSide(read("{ c'4 r2. }").score, 0, 0, 1, 1), /slur/);
  // Taken away with the plain slur tool: its side goes with it.
  M.toggleSlur(plain, 0, 0, 0);
  assert.equal(plain.staves[0].events[0].slurDir, undefined);
  assert.doesNotMatch(engrave(plain), /\^\(/);
  // A note made a rest keeps no side.
  const rested = read("{ c'4_( d') e' f' }").score;
  M.remove(rested, 0, 0);
  assert.equal(rested.staves[0].events[0].slurDir, undefined);
});

test("the dot goes round: none, one, two, none (#469)", () => {
  assert.deepEqual([0, 1, 2].map(M.nextDots), [1, 2, 0]);
  assert.equal(M.nextDots(undefined), 1);
  assert.deepEqual([0, 1, 2].map(M.dotsWord), ["", " dotted", " double-dotted"]);
  const { score } = read("{ \\time 2/4 a''4 g''4 | c''2 }");
  M.setDuration(score, 0, 0, 4, M.nextDots(0));
  assert.match(engrave(score), /a''4\. g''8 \|/);
  M.setDuration(score, 0, 0, 4, M.nextDots(score.staves[0].events[0].dots));
  assert.match(engrave(score), /a''4\.\. g''16 \|/, "two dots, the next note shortened to fit");
  assert.equal(M.notated(4, 2), M.notated(4) + M.notated(8) + M.notated(16));
  M.setDuration(score, 0, 0, 4, M.nextDots(score.staves[0].events[0].dots));
  assert.doesNotMatch(engrave(score), /a''4\./, "and back to none");
});
