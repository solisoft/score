// What used to open read-only now opens in the score editor (#402): each
// construct is read into the model, written back to the same meaning (read
// again, the same model), kept through an edit made elsewhere, and engraved
// with every note and rest numbered as the model numbers them.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);
const h = M.notated(2);
const e8 = M.notated(8);
const A4 = { rest: false, pitches: [{ d: 12, alter: 0 }] };

/** The model of `src` as the page reads it: with where each note is written. */
function parse(src) {
  return M.fromParsed(JSON.parse(score_json(src)), src, { spans: JSON.parse(source_spans(src)) });
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
  const plain = (events) => events.map(({ id, tuplet, ...ev }) => ({ ...ev, tuplet: tuplet && { n: tuplet.n, d: tuplet.d, ...(tuplet.outer ? { outer: { n: tuplet.outer.n, d: tuplet.outer.d } } : {}) } }));
  return JSON.parse(JSON.stringify(score.staves.map((st) => ({ ...st, events: plain(st.events), ...(st.ossias ? { ossias: st.ossias.map((o) => ({ ...o, events: plain(o.events) })) } : {}) }))));
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

// ---- Bars of their own length: a bar line inside a bar, a cadenza --------------------

test("a repeat sign inside a bar ends that bar there, as the engraver ends it; the repeat is kept", () => {
  const { score, source } = roundTrip("{ c'4 d'4 \\bar \".|:\" e'4 f'4 g'2 | a'1 \\bar \":|.\" }");
  assert.equal(M.barLength(score, 0), h);
  assert.ok(M.isOddBar(score, 0) && !M.isOddBar(score, 1));
  assert.deepEqual(score.repeats, [{ from: 1, to: 2, endings: [] }]);
  assert.match(source, /c'4 d'4 \\bar "\|" \| \\repeat volta 2 \{ e'4 f'4 g'2 \| a'1 \}/);
  // A half note typed at its start fills it; a whole note is tied over its end.
  M.write(score, 0, 0, M.notated(1), A4);
  assert.match(engrave(score), /a'2~ \\bar "\|" \| \\repeat volta 2 \{ a'2 g'2/);
  // Bars put in before it move it along.
  M.insertBars(score, 0, 1);
  assert.ok(M.isOddBar(score, 1) && M.barLength(score, 1) === h);
  engrave(score);
  // A repeat that starts inside a bar with no bar line there is the engraver's to refuse.
  assert.throws(() => editor_view("{ c'2 \\repeat volta 2 { d'2 | e'1 } }", 900, 7, -1, -1));
});

test("a double bar line inside a bar, and a last bar left short by its final bar line", () => {
  const { score, source } = roundTrip("{ c'1 | d'4 e'4 \\bar \"||\" f'2 g'2 | a'4 b'4 c''4 \\bar \"|.\" }");
  assert.equal(M.barLength(score, 1), h);
  assert.equal(M.changeAt(score, 2).line, "||");
  assert.equal(M.barLength(score, M.barsOf(score) - 1), M.notated(2, 1));
  assert.match(source, /d'4 e'4 \\bar "\|\|" \| f'2 g'2 \| a'4 b'4 c''4 \\bar "\|\."/);
  // Taken away from its bar's start: the bar line goes, the bar keeps its length.
  M.setDoubleBar(score, 2, false);
  assert.match(engrave(score), /d'4 e'4 \\bar "\|" \| f'2 g'2/);
});

test("a cadenza: a bar as long as its notes, read, written between \\cadenzaOn and \\cadenzaOff, edited", () => {
  const src = "<< \\new Staff { c'1 | \\cadenzaOn c''8 d'' e'' f'' g'' a'' b'' \\cadenzaOff \\bar \"|\" c'''1 } \\new Staff { \\clef bass c1 | \\cadenzaOn s8*7 \\cadenzaOff \\bar \"|\" c1 } >>";
  const { score, source } = roundTrip(src);
  assert.equal(M.changeAt(score, 1).cadenza, 0);
  assert.equal(M.barLength(score, 1), 7 * e8);
  assert.equal(M.changeAt(score, 2).line, "|");
  assert.match(source, /c'1 \| \\cadenzaOn c''8 d''8 e''8 f''8 g''8 a''8 b''8 \\cadenzaOff \\bar "\|" \| c'''1/);
  // The other staff's bar is as long, written the same way.
  assert.match(source, /c1 \| \\cadenzaOn s2\.\. \\cadenzaOff \\bar "\|" \| c1/);
  // A note typed in it, one taken away.
  M.write(score, 0, M.barStart(score, 1) + e8, e8, { rest: false, pitches: [{ d: 15, alter: 1 }] });
  M.remove(score, 0, 6);
  assert.match(engrave(score), /\\cadenzaOn c''8 dis''8 e''8 f''8 g''8 r8 b''8 \\cadenzaOff/);
  // Played: its seven eighths, seven beats of an eighth's count; the bar after it starts on time.
  const passes = M.playback(score);
  assert.ok(Math.abs(passes[2].start - passes[1].start - (7 / 8) * 4 * 0.6) < 1e-6);
  // The metre is not changed over it.
  assert.throws(() => M.setTimeAt(score, 0, 3, 4), /cadenza/);
  M.setTimeAt(score, 2, 3, 4);
  engrave(score);
});

test("a cadenza that starts inside its bar", () => {
  const { score, source } = roundTrip("{ c'2 \\cadenzaOn d'8 e' f' \\cadenzaOff g'2 a'2 | b'1 }");
  assert.equal(M.changeAt(score, 0).cadenza, h);
  assert.equal(M.barLength(score, 0), h + 3 * e8);
  assert.match(source, /c'2 \\cadenzaOn d'8 e'8 f'8 \\cadenzaOff \| g'2 a'2 \| b'1/);
});

// ---- Staves that change key or metre apart ----------------------------------------------

test("staves changing key apart: each keeps its own keys, at bar lines and inside bars", () => {
  const src = "<< \\new Staff { \\key c \\major c'1 | \\key g \\major d'1 | e'2 \\key f \\major f'2 | g'1 } \\new Staff { \\key c \\major c'1 | \\key d \\major d'1 | e'1 | \\key a \\minor a1 } >>";
  const { score, source } = roundTrip(src);
  assert.equal(score.staves[0].keys, undefined);
  assert.deepEqual(score.staves[1].keys, [{ bar: 1, pos: 0, key: 2 }, { bar: 3, pos: 0, key: 0, mode: "minor" }]);
  assert.match(source, /c'1 \| \\key g \\major d'1 \| e'2 \\key f \\major f'2 \| g'1/);
  assert.match(source, /c'1 \| \\key d \\major d'1 \| e'1 \| \\key a \\minor a1/);
  // The keys in force: the second staff's own.
  assert.equal(M.keyOf(score, 1, M.barStart(score, 2) + h), 2);
  assert.equal(M.keyOf(score, 0, M.barStart(score, 2) + h), -1);
  // A letter typed on it is spelled in its key: an F in D major is F sharp.
  M.letter(score, 1, 2, 3);
  assert.equal(score.staves[1].events[2].pitches[0].alter, 1);
  // The score's key changed from the menu: the staff changes with it, as far from it as it stood.
  M.setKeyAt(score, 2, 3);
  assert.deepEqual(score.staves[1].keys.find((m) => m.bar === 2), { bar: 2, pos: 0, key: 4 });
  // Transposed up a tone, every key of its goes up a tone.
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.deepEqual(score.staves[1].keys.map((m) => m.key), [4, 6, 2]);
  engrave(score);
  // Bars put in and taken away: its keys move with their bars, the key after a bar taken away holds.
  M.insertBars(score, 1, 1);
  assert.deepEqual(score.staves[1].keys.map((m) => m.bar), [2, 3, 4]);
  M.deleteBars(score, 2, 2);
  assert.deepEqual(score.staves[1].keys.map((m) => [m.bar, m.key]), [[2, 6], [3, 2]]);
  engrave(score);
});

test("staves changing key apart through MusicXML", () => {
  const score = read("<< \\new Staff { \\key c \\major c'1 | \\key g \\major d'1 } \\new Staff { \\key c \\major c'1 | \\key d \\major d'1 } >>");
  const back = read(X.fromMusicXML(X.toMusicXML(score)).source);
  assert.deepEqual(back.staves[1].keys, [{ bar: 1, pos: 0, key: 2 }]);
  assert.deepEqual(M.changeAt(back, 1), { bar: 1, key: 1 });
});

test("staves changing metre apart, their bars as long: 6/8 beside 3/4", () => {
  const src = "<< \\new Staff { \\time 4/4 c'1 | \\time 3/4 c'2. | c'2. | \\time 2/4 c'2 } \\new Staff { \\time 4/4 c'1 | \\time 6/8 c'4. c'4. | \\time 3/4 c'2. | \\time 2/4 c'2 } >>";
  const { score, source } = roundTrip(src);
  assert.deepEqual(score.staves[1].times, [{ bar: 1, time: [6, 8] }, { bar: 2, time: [3, 4] }, { bar: 3, time: [2, 4] }]);
  assert.match(source, /c'1 \| \\time 3\/4 c'2\. \| c'2\. \| \\time 2\/4 c'2/);
  assert.match(source, /c'1 \| \\time 6\/8 c'4\. c'4\. \| \\time 3\/4 c'2\. \| \\time 2\/4 c'2/);
  // Notes written in it; bars put in after the change and taken away.
  M.write(score, 1, M.barStart(score, 1), e8, A4);
  M.insertBars(score, 2, 1);
  assert.deepEqual(score.staves[1].times.map((m) => m.bar), [1, 3, 4]);
  M.deleteBars(score, 1, 1);
  // The bar put in kept the 6/8 before it: now bar 1, it starts that metre again.
  assert.deepEqual(score.staves[1].times, [{ bar: 1, time: [6, 8] }, { bar: 2, time: [3, 4] }, { bar: 3, time: [2, 4] }]);
  engrave(score);
  // The metre changed from the menu would leave its own behind: refused, said.
  assert.throws(() => M.setTimeAt(score, 1, 5, 4), /metre on its own/);
  // Bars of different lengths are the engraver's to refuse.
  assert.ok(parse("<< \\new Staff { \\time 4/4 c'1 | \\time 3/4 c'2. } \\new Staff { \\time 4/4 c'1 | \\time 2/4 c'2 } >>").unsupported);
});

// ---- A tuplet in a tuplet -------------------------------------------------------------------

test("a tuplet in a tuplet: read, written back nested, its notes edited, the whole replaced or undone", () => {
  const { score, source } = roundTrip("{ \\tuplet 3/2 { c''4 \\tuplet 3/2 { d''8 e''8 f''8 } g''4 } c''2 | \\tuplet 5/4 { c''8 \\tuplet 3/2 { d''16 e'' f'' } g''8 a'' b'' } c''2 }");
  const ev = score.staves[0].events;
  assert.deepEqual(ev[1].tuplet.outer && { n: ev[1].tuplet.n, d: ev[1].tuplet.d, outer: { n: ev[1].tuplet.outer.n, d: ev[1].tuplet.outer.d } }, { n: 3, d: 2, outer: { n: 3, d: 2 } });
  assert.equal(ev[0].tuplet.outer, undefined);
  // Each inner eighth lasts a third of two thirds of a quarter.
  assert.equal(M.ticksOf(ev[1]), (M.notated(8) * 4) / 9);
  assert.equal(M.starts(score.staves[0])[5], h);
  assert.match(source, /\\tuplet 3\/2 \{ c''4 \\tuplet 3\/2 \{ d''8 e''8 f''8 \} g''4 \} c''2 \| \\tuplet 5\/4 \{ c''8 \\tuplet 3\/2 \{ d''16 e''16 f''16 \} g''8 a''8 b''8 \} c''2/);
  // A note of the inner one changed, then transposed: still nested.
  M.letter(score, 0, 2, 0);
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(engrave(score), /\\tuplet 3\/2 \{ d''4 \\tuplet 3\/2 \{ e''8 d''8 g''8 \} a''4 \}/);
  // Written over, the whole outer tuplet goes: a half note in its place.
  M.write(score, 0, 0, h, A4);
  assert.match(engrave(score), /^ {2}a'2 d''2 \|/m);
  // Undone as one plain value from any of its notes, inner or outer.
  const i = score.staves[0].events.findIndex((x) => x.tuplet?.outer);
  M.removeTuplet(score, 0, i);
  assert.ok(score.staves[0].events.every((x) => !x.tuplet));
  assert.match(engrave(score), /\| d''2 d''2/);
});

test("a tuplet in a tuplet goes out to MusicXML with its whole ratio", () => {
  const score = read("{ \\tuplet 3/2 { c''4 \\tuplet 3/2 { d''8 e''8 f''8 } g''4 } c''2 }");
  const xml = X.toMusicXML(score);
  assert.match(xml, /<actual-notes>9<\/actual-notes><normal-notes>4<\/normal-notes>/);
  // Two brackets, each its own ratio; read back, the same tuplets.
  assert.equal((xml.match(/<tuplet type="start" number="\d">/g) ?? []).length, 2);
  const back = read(X.fromMusicXML(xml).source);
  assert.deepEqual(shape(back), shape(score));
});

// ---- Kept as written: \override, \set, \tweak, \with, \layout, \paper ----------------------------

test("\\override, \\set, \\tweak and the like before a note: kept as written, through edits around them", () => {
  const src = "{ \\override NoteHead.color = #red c'4 \\once \\override Stem.length = #10 d'4 \\tweak color #blue e'4 \\set Staff.midiInstrument = \"flute\" f'4 | \\revert NoteHead.color g'2 \\temporary \\override Beam.positions = #'(3 . 3) a'8 b'8 \\undo \\omit Stem c''4 | \\hide Stem \\override Score.BarNumber.break-visibility = ##(#t #t #t) r1 }";
  const result = parse(src);
  assert.equal(result.lost, undefined, "nothing is lost");
  const { score, source } = roundTrip(src);
  const ev = score.staves[0].events;
  assert.deepEqual(ev[0].before, ["\\override NoteHead.color = #red"]);
  assert.deepEqual(ev[2].before, ["\\tweak color #blue"]);
  assert.deepEqual(ev[5].before, ["\\temporary \\override Beam.positions = #'(3 . 3)"]);
  assert.match(source, /\\override NoteHead\.color = #red c'4 \\once \\override Stem\.length = #10 d'4 \\tweak color #blue e'4 \\set Staff\.midiInstrument = "flute" f'4 \| \\revert NoteHead\.color g'2/);
  assert.match(source, /\| \\hide Stem \\override Score\.BarNumber\.break-visibility = ##\(#t #t #t\) r1/);
  // A note with a setting that holds on, written over: the setting stays, on what is written there.
  M.write(score, 0, 0, h, A4);
  assert.match(engrave(score), /^ {2}\\override NoteHead\.color = #red a'2 \\tweak color #blue e'4/m);
  // One that is the note's own (\once, \tweak) goes with it.
  M.write(score, 0, h, q, A4);
  assert.match(engrave(score), /a'2 a'4 \\set Staff\.midiInstrument/);
  // Transposed, copied and pasted: the settings travel with their notes.
  M.transpose(score, { steps: 1, semitones: 2 });
  const clip = M.copy(score, 0, 0, 0);
  M.paste(score, 0, M.barStart(score, 2), clip);
  assert.match(engrave(score), /\| \\hide Stem \\override Score\.BarNumber[^|]*\\override NoteHead\.color = #red b'2/);
  // The bar they are in taken away: those that hold on go on with the next bar.
  M.deleteBars(score, 0, 0);
  assert.match(engrave(score), /^ {2}\\override NoteHead\.color = #red \\set Staff\.midiInstrument = "flute" \\revert NoteHead\.color a'2/m);
});

test("a \\tweak on an articulation, and a setting after the last note, are named before they go", () => {
  const result = parse("{ c'4-\\tweak color #red -> d'4 e'2 }");
  assert.deepEqual(result.lost, ["the settings the engraver passes over (\\tweak color)"]);
  assert.equal(result.score.staves[0].events[1].before, undefined);
});

test("a staff's \\with, the \\layout blocks and what \\paper says more: kept as written", () => {
  const src = "\\paper { indent = 0 ragged-right = ##t #(set-paper-size \"a5\") left-margin = 10\\mm print-page-number = ##f } \\layout { \\context { \\Staff \\RemoveEmptyStaves } } << \\new Staff \\with { \\RemoveEmptyStaves instrumentName = \"Flute\" \\override StaffSymbol.line-count = #3 \\consists \"Ambitus_engraver\" } { c'1 | d'1 } \\new Staff { R1 | e'1 } >>";
  const result = parse(src);
  assert.equal(result.lost, undefined, "nothing is lost");
  const { score, source } = roundTrip(src);
  assert.equal(score.staves[0].withMore, '\\RemoveEmptyStaves \\override StaffSymbol.line-count = #3 \\consists "Ambitus_engraver"');
  assert.equal(score.staves[0].name, "Flute");
  assert.deepEqual(score.layout, ["\\layout { \\context { \\Staff \\RemoveEmptyStaves } }"]);
  assert.deepEqual(score.paper.more, ["ragged-right = ##t", "print-page-number = ##f"]);
  assert.match(source, /\\paper \{ #\(set-paper-size "a5"\) left-margin = 10\\mm indent = 0\\mm ragged-right = ##t print-page-number = ##f \}\n\\layout \{ \\context \{ \\Staff \\RemoveEmptyStaves \} \}/);
  assert.match(source, /\\new Staff \\with \{ instrumentName = "Flute" \\RemoveEmptyStaves \\override StaffSymbol\.line-count = #3 \\consists "Ambitus_engraver" \}/);
  // The staff renamed and the paper changed from the menus: what was kept stays.
  score.staves[0].name = "Fl.";
  M.setPaper(score, { size: "letter", staffSize: 18 });
  const after = engrave(score);
  assert.match(after, /instrumentName = "Fl\." \\RemoveEmptyStaves/);
  assert.match(after, /set-paper-size "letter"\) left-margin = 10\\mm indent = 0\\mm ragged-right = ##t/);
  // \RemoveEmptyStaves in a \layout inside \score: kept too.
  const inScore = read("\\score { << \\new Staff { c'1 } \\new Staff { R1 } >> \\layout { \\context { \\Staff \\RemoveEmptyStaves } } }");
  assert.deepEqual(inScore.layout, ["\\layout { \\context { \\Staff \\RemoveEmptyStaves } }"]);
  assert.match(engrave(inScore), /\\RemoveEmptyStaves/);
});

test("\\change Staff in the middle of a hand-written beam: kept, through an edit elsewhere", () => {
  const src = "\\new PianoStaff << \\new Staff = \"up\" { c''8[ d'' \\change Staff = \"down\" c8 e8] \\change Staff = \"up\" c''2 | d''1 } \\new Staff = \"down\" { \\clef bass s1 | c1 } >>";
  const { score, source } = roundTrip(src);
  assert.match(source, /c''8\[ d''8 \\change Staff = "down" c8 e8\] \\change Staff = "up" c''2/);
  M.write(score, 0, M.barStart(score, 1), q, A4);
  assert.match(engrave(score), /c''8\[ d''8 \\change Staff = "down" c8 e8\]/);
});

// ---- Tablature, cue notes, an ossia ---------------------------------------------------------

test("a tablature is a staff of notes drawn as frets: read, written as a TabStaff, edited", () => {
  const src = "<< \\new Staff { \\clef \"treble_8\" c'4 e'4\\2 g'4 c''4 | d'1 } \\new TabStaff \\with { stringTunings = #guitar-tuning } { c'4 e'4\\2 g'4 c''4 | d'1 } >>";
  const { score, source } = roundTrip(src);
  assert.ok(M.isTab(score, 1) && !M.isTab(score, 0));
  assert.equal(score.staves[1].withMore, "stringTunings = #guitar-tuning");
  assert.match(source, /\\new TabStaff \\with \{ stringTunings = #guitar-tuning \} \{\n {4}\\key c \\major \\time 4\/4\n {4}c'4 e'4\\2 g'4 c''4 \| d'1/);
  // A note typed on it, transposed with the score; it has no clef to set.
  M.write(score, 1, M.barStart(score, 1), h, A4);
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(engrave(score), /\\new TabStaff[^]*\| b'2 e'2/);
  assert.throws(() => M.setClefAt(score, 1, 1, "bass"), /no clef/);
});

test("cue notes: in a CueVoice beside the part's rests, or in its own voice; kept through edits", () => {
  const { score, source } = roundTrip("{ c'1 | << { r1 } \\new CueVoice { e''4 f''4 g''4 a''4 } >> | d'1 }");
  assert.ok(score.staves[1].events.filter((ev) => !ev.rest).every((ev) => ev.cue));
  assert.match(source, /c'1 \| << \{ r1 \} \\new CueVoice \{ e''4 f''4 g''4 a''4 \} >> \| d'1/);
  // A note written elsewhere, the cue notes stay as they are.
  M.write(score, 0, 0, h, A4);
  assert.match(engrave(score), /a'2 c'2 \| << \{ r1 \} \\new CueVoice \{ e''4 f''4 g''4 a''4 \} >>/);
  // \cueDuring: the quoted notes, drawn small, the part's own rest beside them.
  const quoted = roundTrip("flute = { c''1 d''1 } \\addQuote \"flute\" \\flute { c'1 \\cueDuring \"flute\" #UP { R1 } }");
  assert.match(quoted.source, /c'1 \| << \\new CueVoice \{ d''1 \} \{ r1 \} >>/);
  // Inline, around a tuplet.
  const inline = roundTrip("{ c'1 \\new CueVoice { d''2 \\tuplet 3/2 { e''4 f'' g'' } } e'1 }");
  assert.match(inline.source, /\\new CueVoice \{ d''2 \\tuplet 3\/2 \{ e''4 f''4 g''4 \} \}/);
});

test("an ossia: kept over its bars as written, the bars under it edited, moved with them", () => {
  const src = "<< \\new Staff = \"main\" { \\key g \\major c'1 << { d'2 e'2 | f'1 } \\new Staff \\with { alignAboveContext = \"main\" } { \\clef bass e2 \\tuplet 3/2 { f4 g a } | b1 } >> g'1 } \\new Staff { c1 c c c } >>";
  const { score, source } = roundTrip(src);
  const [o] = score.staves[0].ossias;
  assert.deepEqual([o.bar, o.bars, o.clef, o.with], [1, 2, "bass", 'alignAboveContext = "main"']);
  assert.match(source, /c'1 \| << \{ d'2 e'2 \| f'1 \} \\new Staff \\with \{ alignAboveContext = "main" \} \{ \\clef bass e2 \\tuplet 3\/2 \{ f4 g4 a4 \} b1 \} >> \| g'1/);
  // The bars under it edited.
  M.write(score, 0, M.barStart(score, 1), q, A4);
  assert.match(engrave(score), /<< \{ a'4 d'4 e'2 \| f'1 \}/);
  // A bar put in before it moves it; one put in under it grows it with a silent bar.
  M.insertBars(score, 0, 1);
  assert.equal(score.staves[0].ossias[0].bar, 2);
  M.insertBars(score, 3, 1);
  assert.equal(score.staves[0].ossias[0].bars, 3);
  assert.match(engrave(score), /\\clef bass e2 \\tuplet 3\/2 \{ f4 g4 a4 \} s1 b1 \}/);
  // Transposed with the score.
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(engrave(score), /\\clef bass fis2 \\tuplet 3\/2 \{ g4 a4 b4 \} s1 cis'1 \}/);
  // The metre is not changed under it; its bars taken away take it.
  assert.throws(() => M.setTimeAt(score, 1, 3, 4), /ossia/);
  M.deleteBars(score, 2, 2);
  assert.equal(score.staves[0].ossias, undefined);
  engrave(score);
});

// ---- Lines of chord names and figured basses -----------------------------------------------

test("a tuplet in a line of chord names and in a figured bass, figures the tools do not write: kept", () => {
  const src = "<< \\new Staff { c'2 \\tuplet 3/2 { d'4 e' f' } | g'1 } \\new ChordNames \\chordmode { c2 \\tuplet 3/2 { d4:m e:m f } | g1:7 } \\new FiguredBass \\figuremode { <6>2 \\tuplet 3/2 { <_+>4 <6 5 4 3 2> s } | <7>1 } >>";
  const { score, source } = roundTrip(src);
  assert.match(source, /\\new ChordNames \\chordmode \{\n {4}c2 \\tuplet 3\/2 \{ d4:m e4:m f4 \} \| g1:7/);
  assert.match(source, /\\figuremode \{\n {4}<6>2 \\tuplet 3\/2 \{ <_\+>4 <6 5 4 3 2>4 s4 \} \| <7>1/);
  const figures = score.staves[2].events;
  assert.equal(figures[1].figureRaw, "<_+>");
  // A figure typed over one kept as written: the typed one.
  M.setFigureAt(score, 2, 0, "6 4");
  M.setFigureAt(score, 2, M.starts(score.staves[2])[1], "5");
  assert.match(engrave(score), /<6 4>2 \\tuplet 3\/2 \{ <5>4 <6 5 4 3 2>4 s4 \}/);
  // A chord changed at the bar after them; inside the tuplet the line refuses to be cut.
  M.setChordAt(score, 1, M.barStart(score, 1), "Am");
  assert.match(engrave(score), /\| a1:m/);
  assert.throws(() => M.setChordAt(score, 1, h + M.ticksOf(score.staves[1].events[1]) / 2, "F"));
});

test("notes set smaller (\\tiny, \\small …): kept with the command that sets them", () => {
  const { score, source } = roundTrip("{ c'4 \\tiny d'4 e'4 \\normalsize f'4 | \\small g'1 }");
  assert.deepEqual(score.staves[0].events[1].before, ["\\tiny"]);
  assert.match(source, /c'4 \\tiny d'4 e'4 \\normalsize f'4 \| \\small g'1/);
  // Written over, the size holds on where the music goes on.
  M.write(score, 0, q, h, A4);
  assert.match(engrave(score), /c'4 \\tiny a'2 \\normalsize f'4/);
});

test("what the engraver itself refuses is still left to the text, named", () => {
  // A pickup after the first note, staves whose bars last differently, voices inside voices.
  for (const src of ["{ c'1 | \\partial 4 d'4 | e'1 }", "<< \\new Staff { \\time 3/4 c'2. } \\new Staff { \\time 4/4 c'1 } >>", "{ \\time 4/4 c'2 \\time 2/4 d'2 }"]) {
    assert.throws(() => editor_view(src, 900, 7, -1, -1));
  }
  assert.ok(parse("{ c'1 | \\partial 4 d'4 | e'1 }").unsupported.includes("a pickup after the first note"));
  assert.ok(parse("{ c'2 \\time 2/4 d'2 }").unsupported.includes("a change of metre inside a bar"));
});
