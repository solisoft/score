// The signs the engraver draws and the tools now offer (#1039): an
// arpeggio's styles, a tremolo between two notes, the sostenuto and the
// soft pedal, every fermata and ornament, shape notes for a staff, a
// rhythmic staff — each put from the model, read by the engraver, and
// refused where it makes no sense.
//
//   node --test tests/js/signs_1039.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, reading, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

function withSpans(text) {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return parsed;
}

function open(src) {
  const read = M.fromParsed(withSpans(src), src, { parse: withSpans });
  assert.ok(read.score, `opens: ${read.unsupported}`);
  return read.score;
}

/** The model's text, which the engraver draws and numbers as the model does. */
function written(score) {
  const { source, items } = M.toLilyPond(score);
  const view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  assert.equal(view.items.length, items.length, source);
  return source;
}

/** The notes a text plays: [key, on, off], in order. */
const signs = (src) => JSON.parse(reading(src)).staves.map((staff) => staff.signs);

const CHORDS = "{ \\time 4/4 <c' e' g'>4 <d' f' a'>4 c''4 r4 }";

test("an arpeggio is put in each of its styles, changed, and taken away", () => {
  const score = open(CHORDS);
  for (const [style, command, said] of [["bracket", "arpeggioBracket", "Bracket"], ["parenthesis", "arpeggioParenthesis", "Paren"], ["up", "arpeggioArrowUp", "ArrowUp"], ["down", "arpeggioArrowDown", "ArrowDown"]]) {
    M.toggleArpeggio(score, 0, 0, style);
    assert.equal(M.arpeggioAt(score, 0, 0), style);
    const text = written(score);
    assert.ok(text.includes(`\\${command} <c' e' g'>4\\arpeggio \\arpeggioNormal`), text);
    assert.ok(signs(text)[0].includes(`arpeggio ${said}`), `the engraver reads ${said}`);
  }
  // The chord after it is rolled as usual: the style is this chord's.
  M.toggleArpeggio(score, 0, 1);
  assert.equal(M.arpeggioAt(score, 0, 1), "wave");
  assert.deepEqual(signs(written(score))[0].filter((w) => w.startsWith("arpeggio")), ["arpeggio ArrowDown", "arpeggio Wave"]);
  // The same style again takes it away; the plain one in its place changes it.
  M.toggleArpeggio(score, 0, 0);
  assert.equal(M.arpeggioAt(score, 0, 0), "wave");
  M.toggleArpeggio(score, 0, 0);
  assert.equal(M.arpeggioAt(score, 0, 0), null);
  assert.ok(!written(score).includes("arpeggioArrow"));
  // Refused: a style there is not, one note alone, a rest.
  assert.throws(() => M.toggleArpeggio(score, 0, 0, "zigzag"), /a wavy line, a bracket/);
  assert.throws(() => M.toggleArpeggio(score, 0, 2, "bracket"), /add notes to it first/);
  assert.throws(() => M.toggleArpeggio(score, 0, 3, "bracket"));
  assert.equal(score.staves[0].events[2].arpeggio, false, "a refusal writes nothing");
});

test("a bracket's chord is played together, a down arrow's from the top: as the text said before the editor", () => {
  for (const style of ["arpeggioBracket", "arpeggioArrowDown", "arpeggioParenthesis"]) {
    const src = `{ \\time 4/4 \\${style} <c' e' g'>1\\arpeggio }`;
    const back = M.toLilyPond(open(src)).source;
    assert.deepEqual([...midi(back, 120, 4, 0)], [...midi(src, 120, 4, 0)], style);
  }
});

test("a tremolo between two notes: put, read back, changed, taken away", () => {
  const score = open("{ \\time 4/4 c''4 e''4 g''2 | c''2 e''2 }");
  M.setTremoloPair(score, 0, 0, 16);
  assert.equal(M.tremoloPairOf(score, 0, 0), 16);
  assert.equal(M.tremoloPairOf(score, 0, 1), 16, "the second note is of it");
  assert.equal(M.tremoloPairOf(score, 0, 2), 0);
  let text = written(score);
  assert.ok(text.includes("\\repeat tremolo 4 { c''16 e''16 } g''2 |"), text);
  assert.deepEqual(signs(text)[0].filter((w) => w.startsWith("tremolo")), ["tremolo of two 2 true", "tremolo of two 2 false"]);
  // Read back, it is the same score; it still fills its bar.
  const again = open(text);
  assert.equal(M.tremoloPairOf(again, 0, 0), 16);
  assert.equal(again.staves[0].events[0].base, 4, "each lasts a quarter");
  assert.equal(M.toLilyPond(again).source, text);
  // From the second note, in thirty-seconds: the same two notes, changed.
  M.setTremoloPair(score, 0, 1, 32);
  text = written(score);
  assert.ok(text.includes("\\repeat tremolo 8 { c''32 e''32 }"), text);
  // Two half notes: a whole note of tremolo.
  M.setTremoloPair(score, 0, 3, 16);
  assert.ok(written(score).includes("\\repeat tremolo 8 { c''16 e''16 }"));
  // The same again takes it away, and the notes are plain notes.
  M.setTremoloPair(score, 0, 0, 32);
  assert.equal(M.tremoloPairOf(score, 0, 0), 0);
  assert.ok(written(score).includes("c''4 e''4 g''2 |"));
});

test("a tremolo between two notes is refused where it cannot be written, and nothing is changed", () => {
  const score = open("{ \\time 4/4 c''4 e''8 g''8 r4 a''4 | c''4. e''4. r4 | \\tuplet 3/2 { c''4 d'' e'' } g''2 | c''1 | e''1 }");
  const before = JSON.stringify(score);
  assert.throws(() => M.setTremoloPair(score, 0, 0, 16), /two notes of the same value/, "a quarter then an eighth");
  assert.throws(() => M.setTremoloPair(score, 0, 2, 16), /a note after this one/, "a rest after it");
  assert.throws(() => M.setTremoloPair(score, 0, 3, 16), /select a note|Select a note/i, "a rest");
  assert.throws(() => M.setTremoloPair(score, 0, 5, 16), /with no dot/, "dotted notes");
  assert.throws(() => M.setTremoloPair(score, 0, 8, 16), /outside a tuplet/, "in a triplet");
  assert.throws(() => M.setTremoloPair(score, 0, 12, 16), /a whole note at most/, "two whole notes");
  assert.throws(() => M.setTremoloPair(score, 0, 1, 8), /shorter than the note/, "eighths on eighths");
  assert.throws(() => M.setTremoloPair(score, 0, 0, 64), /eighths, sixteenths or thirty-seconds/);
  assert.equal(JSON.stringify(score), before);
});

test("one of a tremolo's two notes changed is a plain note again: the text never says a tremolo that is not one", () => {
  const score = open("{ \\time 4/4 \\repeat tremolo 4 { c''16 e'' } g''2 }");
  assert.equal(M.tremoloPairOf(score, 0, 0), 16);
  // The second note made a rest.
  const rested = structuredClone(score);
  M.remove(rested, 0, 1);
  assert.equal(M.tremoloPairOf(rested, 0, 0), 0);
  assert.ok(!written(rested).includes("tremolo"), written(rested));
  // The first note given a dot's worth less: an eighth.
  const shorter = structuredClone(score);
  M.setDuration(shorter, 0, 0, 8, 0);
  assert.ok(!written(shorter).includes("tremolo"), written(shorter));
});

test("the sostenuto and the soft pedal: pressed, let go, both at once with the sustain pedal", () => {
  const score = open("{ \\time 4/4 c''4 d''4 e''4 r4 }");
  M.setOtherPedal(score, 0, 0, "sostenuto", "on");
  M.setOtherPedal(score, 0, 2, "sostenuto", "off");
  M.setOtherPedal(score, 0, 0, "corda", "on");
  M.setOtherPedal(score, 0, 3, "corda", "off");
  M.setPedal(score, 0, 0, "on");
  M.setOtherPedal(score, 0, 1, "sostenuto", "change");
  const text = written(score);
  assert.ok(text.includes("c''4\\sustainOn\\sostenutoOn\\unaCorda d''4\\sostenutoOff\\sostenutoOn e''4\\sostenutoOff r4\\treCorde"), text);
  assert.deepEqual(signs(text)[0].filter((w) => w.startsWith("pedal ")), ["pedal on", "pedal 66 true", "pedal 67 true", "pedal 66 false", "pedal 66 true", "pedal 66 false", "pedal 67 false"]);
  // Read back: the pedals, and no "Sost. Ped." left as words.
  const again = open(text);
  assert.equal(again.staves[0].events[0].sostOn, true);
  assert.equal(again.staves[0].events[0].cordaOn, true);
  assert.deepEqual(again.staves[0].events.map((ev) => ev.texts), [[], [], [], []]);
  assert.equal(M.toLilyPond(again).source, text);
  // The same again takes it away; a pedal there is not is refused.
  M.setOtherPedal(score, 0, 0, "sostenuto", "on");
  assert.equal(score.staves[0].events[0].sostOn, undefined);
  assert.throws(() => M.setOtherPedal(score, 0, 0, "wah", "on"), /no such pedal/);
  // A rest that only lets a pedal go is kept when its bar is tidied.
  assert.equal(M.isBareRest(score.staves[0].events[3]), false);
});

test("a note takes one fermata: another takes its place; a rest takes a fermata and no ornament", () => {
  const score = open("{ \\time 4/4 c''4 d''4 r2 }");
  M.toggleArticulation(score, 0, 0, "fermata");
  M.toggleArticulation(score, 0, 0, "longfermata");
  assert.deepEqual(score.staves[0].events[0].arts, ["longfermata"]);
  M.toggleArticulation(score, 0, 0, "prallup");
  M.toggleArticulation(score, 0, 0, "lheel");
  assert.ok(written(score).includes("c''4\\longfermata\\prallup\\lheel"), written(score));
  M.toggleArticulation(score, 0, 2, "veryshortfermata");
  assert.deepEqual(score.staves[0].events[2].arts, ["veryshortfermata"]);
  assert.throws(() => M.toggleArticulation(score, 0, 2, "haydnturn"), /select a note/);
  assert.throws(() => M.toggleArticulation(score, 0, 0, "wobble"), /no such articulation/);
  assert.deepEqual(score.staves[0].events[0].arts, ["longfermata", "prallup", "lheel"], "a refusal writes nothing");
  // Every sign the tools offer is one the engraver draws.
  for (const name of Object.values(M.ARTICULATION_FAMILIES).flat()) {
    const one = open("{ \\time 4/4 c''1 }");
    M.toggleArticulation(one, 0, 0, name);
    assert.ok(signs(written(one))[0].includes(`script ${name} 0`), name);
  }
});

test("a staff in shape notes: set for the staff, in the minor set under a minor key, and taken away", () => {
  const score = open("<< \\new Staff { \\time 4/4 c''4 d'' e'' f'' } \\new Staff { \\clef bass c4 d e f } >>");
  assert.equal(M.shapeNotesOf(score, 0), "");
  M.setShapeNotes(score, 0, "aikenHeads");
  assert.equal(M.shapeNotesOf(score, 0), "aikenHeads");
  assert.equal(M.shapeNotesOf(score, 1), "", "the other staff keeps its heads");
  let text = written(score);
  assert.ok(text.includes("\\aikenHeads c''4"), text);
  const [upper, lower] = signs(text);
  assert.ok(upper.filter((w) => w.startsWith("set shapeNoteStyles")).length >= 4, "every note of the staff");
  assert.equal(lower.filter((w) => w.startsWith("set shapeNoteStyles")).length, 0);
  // Another set takes its place; read back, the staff says which.
  M.setShapeNotes(score, 0, "sacredHarpHeads");
  text = written(score);
  assert.ok(text.includes("\\sacredHarpHeads c''4") && !text.includes("aikenHeads"), text);
  assert.equal(M.shapeNotesOf(open(text), 0), "sacredHarpHeads");
  M.setShapeNotes(score, 0, "");
  assert.ok(!written(score).includes("Heads"));
  // In a minor key the degrees count from la.
  const minor = open("{ \\key a \\minor \\time 4/4 a'4 b' c'' d'' }");
  M.setShapeNotes(minor, 0, "funkHeads");
  assert.ok(written(minor).includes("\\funkHeadsMinor a'4"), written(minor));
  assert.equal(M.shapeNotesOf(minor, 0), "funkHeads");
  // Refused: heads there are not, a drum staff.
  assert.throws(() => M.setShapeNotes(score, 0, "squareHeads"), /no such note heads/);
  const drums = open("\\new DrumStaff \\drummode { \\time 4/4 bd4 sn bd sn }");
  assert.throws(() => M.setShapeNotes(drums, 0, "aikenHeads"), /a staff of notes/);
});

test("a rhythmic staff opens in the editor, is edited, and stays one", () => {
  const score = open("\\new RhythmicStaff { \\time 4/4 c4 c8 c c4 r }");
  assert.equal(score.staves[0].rhythmic, true);
  M.setDuration(score, 0, 0, 8, 0);
  const text = written(score);
  assert.ok(text.startsWith("\\new RhythmicStaff"), text);
  assert.ok(!text.includes("\\clef"), "no clef on its one line");
  assert.equal(JSON.parse(reading(text)).staves[0].kind, "Rhythmic");
  assert.throws(() => M.setClefAt(score, 0, 1, "bass"), /a rhythmic staff has no clef/);
});

test("a bar's rest written R2. stays one while it is the bar's rest", () => {
  const src = "{ \\time 3/4 c''2. | R2. | d''2. }";
  const score = open(src);
  assert.ok(written(score).includes("| R2. |"), written(score));
  // A note written in it: the rest of the bar is rests as any.
  M.write(score, 0, M.barStart(score, 1), M.notated(4), { rest: false, pitches: [{ d: 12, alter: 0 }] });
  assert.ok(/\| a'4 r2 \|/.test(written(score)), written(score));
});

test("a Roman numeral under a note is kept as it is written, until its words are changed", () => {
  const src = "<< \\new Staff { \\time 4/4 c''1 d''1 } \\new Lyrics \\lyricmode { \\markup \\rN { I }1 \\markup \\rN { V 6 5 }1 } >>";
  const score = open(src);
  const text = written(score);
  assert.ok(text.includes("\\addlyrics { \\markup \\rN { I } \\markup \\rN { V 6 5 } }"), text);
  M.setLyric(score, 0, 1, "five");
  assert.ok(written(score).includes("\\addlyrics { \\markup \\rN { I } five }"), written(score));
});

test("the palette offers every sign the model keeps, and nothing it does not", () => {
  const view = readFileSync(new URL("../../app/views/shared/_studio.html.slv", import.meta.url), "utf8");
  const offered = (pattern) => [...view.matchAll(pattern)].map((m) => m[1]);
  const arts = new Set(offered(/data-act="art" data-name="([^"]+)"/g));
  for (const name of arts) assert.ok(M.ARTICULATIONS.includes(name), `the palette's ${name} is an articulation of the model`);
  for (const name of Object.values(M.ARTICULATION_FAMILIES).flat()) assert.ok(arts.has(name), `${name} has its button`);
  assert.deepEqual(offered(/data-act="arpeggio" data-style="([^"]+)"/g).sort(), Object.keys(M.ARPEGGIO_STYLES).sort());
  assert.deepEqual(offered(/data-act="tremolo-pair" data-value="([^"]+)"/g).map(Number).sort((a, b) => a - b), [...M.TREMOLO_PAIRS].sort((a, b) => a - b));
  assert.deepEqual([...new Set(offered(/data-act="pedal" data-pedal="([^"]+)"/g))].sort(), Object.keys(M.PEDALS).sort());
  const heads = /data-field="staff-heads"[\s\S]*?<\/select>/.exec(view)[0];
  assert.deepEqual([...heads.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]), ["", ...M.SHAPE_NOTES]);
  // Each of their words is said in English and in French.
  const keys = [...new Set([...view.matchAll(/t\("app\.editor\.((?:sign|arpeggio|tremolo_pair|pedal_sostenuto|pedal_corda|heads)_[a-z0-9_]+)"\)/g)].map((m) => m[1]))];
  assert.ok(keys.length > 80, `${keys.length} words`);
  for (const locale of ["en", "fr"]) {
    const words = readFileSync(new URL(`../../config/locales/${locale}.yml`, import.meta.url), "utf8");
    for (const key of keys) assert.match(words, new RegExp(`^      ${key}: ".+"$`, "m"), `${locale}: ${key}`);
  }
});
