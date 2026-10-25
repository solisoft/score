// What used to open read-only now opens in the score editor (#402): each
// construct is read into the model, written back to the same meaning (read
// again, the same model), kept through an edit made elsewhere, and engraved
// with every note and rest numbered as the model numbers them.
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
const e8 = M.notated(8);
const A4 = { rest: false, pitches: [{ d: 12, alter: 0 }] };

function parse(src) {
  return M.fromParsed(JSON.parse(score_json(src)), src);
}

/** The model of `src`: it must read, every tool on. */
function read(src) {
  const result = parse(src);
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result.score;
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

/** The model without its event ids, which every read numbers afresh. */
function shape(score) {
  return JSON.parse(JSON.stringify(score.staves.map((st) => ({ ...st, events: st.events.map(({ id, tuplet, ...ev }) => ({ ...ev, tuplet: tuplet && { n: tuplet.n, d: tuplet.d, ...(tuplet.outer ? { outer: { n: tuplet.outer.n, d: tuplet.outer.d } } : {}) } })) }))));
}

/** Read, written, read again: the same model, and the second writing the same text. */
function roundTrip(src) {
  const score = read(src);
  const once = engrave(score);
  const again = read(once);
  assert.deepEqual(shape(again), shape(score), `the same staves read back\n${once}`);
  for (const field of ["changes", "midKeys", "midTempos", "midMarks", "repeats", "pickup", "time", "key"]) assert.deepEqual(again[field], score[field], `the same ${field}\n${once}`);
  assert.equal(engrave(again), once);
  return { score, source: once };
}

// ---- Clefs ------------------------------------------------------------------------------

test("clefs: every clef the engraver draws is read, written back, and set from the tools", () => {
  for (const clef of ["french", "soprano", "mezzosoprano", "baritone", "varbaritone", "subbass", "treble_15", "bass^15", "alto_8", "tenor^8"]) {
    const name = /[_^]/.test(clef) ? `"${clef}"` : clef;
    const { score, source } = roundTrip(`{ \\clef ${name} c'1 | d'1 }`);
    assert.equal(score.staves[0].clef, clef);
    assert.match(source, new RegExp(`\\\\clef ${name.replace(/\^/g, "\\^")} `));
  }
  // Changed at a bar line and inside a bar.
  const score = read("{ \\clef baritone c1 | \\clef varbaritone d2 \\clef french g''2 }");
  assert.deepEqual(score.staves[0].clefs, [{ bar: 1, clef: "varbaritone" }]);
  assert.deepEqual(score.staves[0].midClefs, [{ bar: 1, pos: h, clef: "french" }]);
  M.write(score, 0, 0, q, A4);
  assert.match(engrave(score), /\\clef baritone [^\n]*\n {2}a'4 c2\. \| \\clef varbaritone d2 \\clef french g''2/);
  // A letter typed lands near the clef's middle line: a C clef on the fifth line has F under it.
  const blank = M.newScore();
  M.setClefAt(blank, 0, 0, "baritone");
  M.letter(blank, 0, 0, 3);
  assert.equal(blank.staves[0].events[0].pitches[0].d, 3);
  M.setClefAt(blank, 0, 1, "subbass");
  assert.equal(M.clefAt(blank, 0, 1), "subbass");
  assert.throws(() => M.setClefAt(blank, 0, 1, "treble_22"), /no such clef/);
  // MusicXML: each clef goes out with its line and its octave, and comes back.
  const back = read(X.fromMusicXML(X.toMusicXML(read("{ \\clef mezzosoprano c'1 | \\clef \"bass_15\" c,,1 }"))).source);
  assert.equal(back.staves[0].clef, "mezzosoprano");
  assert.deepEqual(back.staves[0].clefs, [{ bar: 1, clef: "bass_15" }]);
});

// ---- Articulations and drums -----------------------------------------------------------

test("articulations: a brass mute's open and stopped, and each written above or below, kept", () => {
  const { score, source } = roundTrip("{ c''4\\open c''4^\\stopped c''4_. c''4^\\fermata | c''4_> c''2. }");
  assert.deepEqual(score.staves[0].events[0].arts, ["open"]);
  assert.deepEqual(score.staves[0].events[1].artDirs, { stopped: -1 });
  assert.deepEqual(score.staves[0].events[2].artDirs, { staccato: 1 });
  assert.match(source, /c''4\\open c''4\^\\stopped c''4_\. c''4\^\\fermata \| c''4_> c''2\./);
  // Taken away and set again from the tools: back where the engraver puts it.
  M.toggleArticulation(score, 0, 2, "staccato");
  assert.equal(score.staves[0].events[2].artDirs, undefined);
  M.toggleArticulation(score, 0, 2, "staccato");
  assert.match(engrave(score), /c''4-\. c''4\^\\fermata/);
  // The tools offer what they did: a mute's signs are not among them.
  assert.ok(!M.ARTICULATIONS.includes("open") && M.ARTICULATIONS.includes("staccato"));
  // Through MusicXML, above and below stay.
  const back = read(X.fromMusicXML(X.toMusicXML(read("{ c''4_- c''4^\\trill c''4_\\fermata c''4 }"))).source);
  assert.deepEqual(back.staves[0].events.slice(0, 3).map((ev) => ev.artDirs), [{ tenuto: 1 }, { trill: -1 }, { fermata: 1 }]);
});

test("drums: a closed and a half-open hi-hat keep their own signs", () => {
  const { score, source } = roundTrip("\\new DrumStaff \\drummode { hhc4 hho4 hhho4 hh4 }");
  assert.deepEqual(score.staves[0].events.map((ev) => ev.pitches[0].drum), ["hhc", "hho", "hhho", "hh"]);
  assert.match(source, /hhc4 hho4 hhho4 hh4/);
  M.drumHit(score, 0, 3, "hhc");
  assert.equal(score.staves[0].events[3].pitches[0].drum, "hhc");
});

// ---- Metres, marks, tempos --------------------------------------------------------------

test("an added-up metre after the start is written as it was added up", () => {
  const { score, source } = roundTrip("{ \\time 4/4 c'1 | \\time 2+3/8 c'4 c'4. | \\time 3+2/8 c'4. c'4 | \\time 5/8 c'4. c'4 }");
  assert.deepEqual(M.changeAt(score, 1), { bar: 1, time: [5, 8], parts: [2, 3] });
  assert.deepEqual(M.changeAt(score, 2), { bar: 2, time: [5, 8], parts: [3, 2] });
  assert.deepEqual(M.changeAt(score, 3), { bar: 3, time: [5, 8] });
  assert.match(source, /\\time 2\+3\/8 c'4 c'4\. \| \\time 3\+2\/8 c'4\. c'4 \| \\time 5\/8 c'4\. c'4/);
  // A metre set from the menu is a plain one.
  M.setTimeAt(score, 1, 5, 8);
  assert.equal(M.changeAt(score, 1).parts, undefined);
  assert.match(engrave(score), /\| \\time 5\/8 c'4 c'4\. \| \\time 3\+2\/8/);
});

test("marks: words of their own at a bar line and inside a bar, a letter and a jump inside a bar", () => {
  const src = "{ c'2 \\mark \\default d'2 | \\mark \"Trio\" e'1 | f'2 \\mark \\markup \\italic \"dolce\" g'2 | a'2 \\segnoMark b'2 | c''1 }";
  const { score, source } = roundTrip(src);
  assert.deepEqual(M.changeAt(score, 1).words, { text: "Trio", bold: true });
  assert.deepEqual(score.midMarks, [
    { bar: 0, pos: h, mark: "letter" },
    { bar: 2, pos: h, words: { text: "dolce", italic: true } },
    { bar: 3, pos: h, mark: "segno" },
  ]);
  assert.match(source, /c'2 \\mark \\default d'2 \| \\mark "Trio" e'1 \| f'2 \\mark \\markup \\italic "dolce" g'2 \| a'2 \\segnoMark b'2/);
  // Written over, the mark stays where it stands, before what is there now.
  M.write(score, 0, M.barStart(score, 2), q, A4);
  assert.match(engrave(score), /\| a'4 f'4 \\mark \\markup \\italic "dolce" g'2 \|/);
  // A bar put in before them moves them along; the bars taken away take theirs.
  M.insertBars(score, 0, 1);
  assert.deepEqual(score.midMarks.map((m) => m.bar), [1, 3, 4]);
  M.deleteBars(score, 3, 3);
  assert.deepEqual(score.midMarks.map((m) => m.bar), [1, 3]);
  engrave(score);
  // A mark of a sign the editor does not name still leaves the piece to its text.
  assert.ok(parse("{ c'1 \\mark \\markup \\musicglyph \"scripts.ufermata\" d'1 }").unsupported);
});

test("a tempo inside a bar: read, written before its note, played from there", () => {
  const { score, source } = roundTrip("{ \\tempo 4 = 60 c'4 d'4 \\tempo 4 = 120 e'4 f'4 | g'1 | \\tempo \"rit.\" a'2 \\tempo \"a tempo\" b'2 }");
  assert.deepEqual(score.midTempos, [{ bar: 0, pos: h, tempo: { text: "", base: 4, bpm: 120 } }, { bar: 2, pos: h, tempo: { text: "a tempo", base: 4, bpm: 0 } }]);
  assert.match(source, /c'4 d'4 \\tempo 4 = 120 e'4 f'4 \| g'1 \| \\tempo "rit\." a'2 \\tempo "a tempo" b'2/);
  // The tempo in force: 60 at the start, 120 from the middle of the first bar on.
  assert.equal(M.tempoAt(score, 0).bpm, 60);
  assert.equal(M.tempoAt(score, 0, h).bpm, 120);
  assert.equal(M.tempoAt(score, 1).bpm, 120);
  // Played: two beats at 60 (two seconds), then two at 120 (one second); the next bar at 120.
  assert.ok(Math.abs(M.secondsAt(score, h) - 2) < 1e-9);
  assert.ok(Math.abs(M.secondsAt(score, M.barStart(score, 1)) - 3) < 1e-9);
  const passes = M.playback(score);
  assert.ok(Math.abs(passes[0].end - 3) < 1e-6, `the first bar lasts three seconds: ${passes[0].end}`);
  assert.ok(Math.abs(passes[1].end - passes[1].start - 2) < 1e-6);
  // An edit over it keeps it at its time; the metre changed from the menu, it moves with its music.
  M.write(score, 0, q, q, A4);
  assert.match(engrave(score), /c'4 a'4 \\tempo 4 = 120 e'4 f'4/);
  M.setTimeAt(score, 0, 2, 4);
  assert.deepEqual(score.midTempos.map((m) => [m.bar, m.pos]), [[1, 0], [5, 0]]);
  engrave(score);
});
