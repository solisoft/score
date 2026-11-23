// The score read over (#1022): a note out of its instrument's range (written
// pitch for a transposing one) or out of where it is comfortable, a bar the
// text wrote too short or too long, a part that starts — or comes back after
// four bars of rest — with no dynamic; a remark set aside, kept on the
// settings line.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import init, { score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as R from "../../public/eui-score/review.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** The engraver's reading with where each note is written, as the editor reads a text. */
const parse = (src) => ({ ...JSON.parse(score_json(src)), spans: JSON.parse(source_spans(src)) });
/** `src` read as the editor reads it: the model, and the bars the text wrote short or long. */
const read = (src) => M.fromParsed(parse(src), src, { parse });
/** The remarks on `src`, as the editor makes them. */
function remarks(src) {
  const result = read(src);
  assert.equal(result.unsupported, undefined, src);
  return R.review(result.score, { uneven: result.uneven });
}
const only = (list, rule) => list.filter((remark) => remark.rule === rule);
/** One staff of an instrument (its name and General MIDI sound), with `music`. */
const staff = (name, sound, music, clef = "treble") => `\\new Staff \\with { instrumentName = "${name}" midiInstrument = "${sound}" } { \\clef ${clef} ${music} }`;

const FRENCH = Object.assign({}, ...readdirSync(new URL("../../config/editor_words/fr/", import.meta.url)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(`../../config/editor_words/fr/${f}`, import.meta.url), "utf8"))));
function inFrench(fn) {
  globalThis.EUI_WORDS = FRENCH;
  globalThis.EUI_WORDS_LOCALE = "fr";
  try {
    return fn();
  } finally {
    delete globalThis.EUI_WORDS;
    delete globalThis.EUI_WORDS_LOCALE;
  }
}

// ---- Range ----------------------------------------------------------------------------------

test("range: a violin's F below its G string is out of its range; its G, and its highest, are not", () => {
  const low = remarks(staff("Violin", "violin", "\\dynamicUp f1\\p | g1 | e''''1 | a''''1"));
  const range = only(low, "range");
  assert.deepEqual(range.map((r) => [r.bar, r.id.split(":")[0], r.level]), [[0, "low", "error"], [3, "high", "error"]]);
  assert.equal(range[0].text, "Violin: F3 is out of its range (the lowest note is G3)");
  assert.equal(range[1].text, "Violin: A7 is out of its range (the highest note is E7)");
  // E7 is in its range, and past where it is comfortable: a hint, not an error.
  const hints = only(low, "comfort");
  assert.deepEqual(hints.map((r) => [r.bar, r.level]), [[2, "hint"]]);
  assert.equal(hints[0].text, "Violin: E7 lies outside the comfortable range (G3 to E6)");
  // Its notes at the edges are nothing to say.
  assert.deepEqual(remarks(staff("Violin", "violin", "g1\\p | e'''1")), []);
});

test("range: a clarinet in B♭ is read at written pitch — a concert D3 is its low E, a concert C3 below it", () => {
  // Concert D3 is written E3, the clarinet's lowest: fine. A piano's D3 is too.
  assert.deepEqual(only(remarks(staff("Clarinet in B♭", "clarinet", "d1\\p")), "range"), []);
  // Concert C3 is written D3: out of the range, said as the player reads it.
  const [remark] = only(remarks(staff("Clarinet in B♭", "clarinet", "c1\\p")), "range");
  assert.equal(remark.text, "Clarinet in B♭: written D3 is out of its range (the lowest written note is E3)");
  // The same note on a clarinet in A (concert C3 written E♭3) is out too; on a flute, by far.
  assert.match(only(remarks(staff("Clarinet in A", "clarinet", "c1\\p")), "range")[0].text, /written E♭3 is out/);
  // Its top: a concert B♭6 is written C7, the highest; a concert C7 is written D7, past it.
  assert.deepEqual(only(remarks(staff("Clarinet in B♭", "clarinet", "bes'''1\\p")), "range"), []);
  assert.match(only(remarks(staff("Clarinet in B♭", "clarinet", "c''''1\\p")), "range")[0].text, /written D7 is out of its range \(the highest written note is C7\)/);
  // A horn in F: written a fifth above, so a concert B1 (written F♯2) is still in its range; a concert A1 is not.
  assert.deepEqual(only(remarks(staff("Horn in F", "french horn", "b,,1\\p", "bass")), "range"), []);
  assert.equal(only(remarks(staff("Horn in F", "french horn", "a,,1\\p", "bass")), "range").length, 1);
});

test("range: in French, plain words a musician reads", () => {
  const text = inFrench(() => R.review(read(staff("Clarinet in B♭", "clarinet", "c1\\p")).score, { name: () => "Clarinette en si♭" })[0].text);
  assert.equal(text, "Clarinette en si♭ : ré2 écrit hors tessiture (la note écrite la plus grave est mi2)");
  const violin = inFrench(() => R.review(read(staff("Violin", "violin", "f1\\p")).score, { name: () => "Violon" })[0].text);
  assert.equal(violin, "Violon : fa2 hors tessiture (le plus grave est sol2)");
});

test("range: one remark a bar, at its note furthest out; a tied note is the same note", () => {
  const list = only(remarks(staff("Flute", "flute", "a4\\p g4 a4 b4 | g1~ | g1")), "range");
  // Bar 0: A3, G3, A3 below the flute's B3 — said once, at G3. Bar 1's G3 is tied over into bar 2: said once.
  assert.deepEqual(list.map((r) => [r.bar, r.text.match(/: (\S+) is/)[1]]), [[0, "G3"], [1, "G3"]]);
  assert.equal(list[0].t, M.notated(4));
});

test("range: an instrument it does not know, the strings section, a voice and a drum kit have no range", () => {
  for (const src of [
    staff("Theremin", "pad 1 (new age)", "c,,,1\\p"),
    staff("Strings", "string ensemble 1", "c,,,1\\p"),
    staff("Voice", "choir aahs", "c,,,1\\p"),
    "\\new DrumStaff \\drummode { bd1\\p }",
  ]) assert.deepEqual(only(remarks(src), "range").concat(only(remarks(src), "comfort")), [], src);
  // A staff with no instrument plays the piano, whose keys go from A0 to C8.
  assert.deepEqual(only(remarks("{ a,,,1\\p }"), "range"), []);
  assert.equal(only(remarks("{ g,,,1\\p }"), "range").length, 1);
});

// ---- Bars that do not add up ---------------------------------------------------------------

test("bars: a bar the text wrote a beat short, and one a beat long, said where the text counts them", () => {
  const short = only(remarks("{ \\time 4/4 c'4\\p d' e' | f'1 | g'1 }"), "bars");
  assert.deepEqual(short.map((r) => [r.bar, r.t, r.level, r.text]), [[0, 0, "error", "Piano: 3 beats instead of 4 (4/4)"]]);
  const long = only(remarks("{ \\time 3/4 c'4\\p d' e' | f'4 g' a' b' | c''2. }"), "bars");
  assert.deepEqual(long.map((r) => [r.bar, r.text]), [[1, "Piano: 4 beats instead of 3 (3/4)"]]);
  // Between two bar checks, a bar and three beats is one bar run on, not one short.
  assert.deepEqual(only(remarks("{ c'1\\p | d'2 e' f'2. | g'1 }"), "bars").map((r) => [r.bar, r.text]), [[1, "Piano: 7 beats instead of 4 (4/4)"]]);
  // Counted in the metre's own beats: eighths in 6/8, and a half beat said as such.
  assert.match(only(remarks("{ \\time 6/8 c'4.\\p d'4 | e'2. }"), "bars")[0].text, /5 beats instead of 6 \(6\/8\)/);
  assert.match(only(remarks("{ \\time 2/4 c'4\\p d'8 | e'2 }"), "bars")[0].text, /1\.5 beats instead of 2/);
  assert.match(inFrench(() => R.review(read("{ \\time 2/4 c'4\\p d'8 | e'2 }").score, { uneven: read("{ \\time 2/4 c'4\\p d'8 | e'2 }").uneven, name: () => "Flûte" }).find((r) => r.rule === "bars").text), /^Flûte : 1,5 temps au lieu de 2 \(2\/4\)$/);
  // Each bar that is wrong, once: those after a short one are counted from it, not from the score's bar lines.
  assert.deepEqual(only(remarks("{ c'4\\p d' e' | f'1 | g'2 a' b' | c''1 }"), "bars").map((r) => r.bar), [0, 2]);
});

test("bars: the last bar short of a bar, unless it is what the pickup leaves", () => {
  assert.deepEqual(only(remarks("{ \\time 4/4 \\partial 4 g'4\\p | c''1 | d''2. }"), "bars"), []);
  const unfinished = only(remarks("{ \\time 4/4 \\partial 4 g'4\\p | c''1 | d''2 }"), "bars");
  assert.deepEqual(unfinished.map((r) => [r.bar, r.text]), [[2, "Piano: 2 beats instead of 4 (4/4)"]]);
  assert.equal(only(remarks("{ c'4\\p d' e' f' | g' a' b' }"), "bars").length, 1, "no pickup: a last bar a beat short");
});

test("bars: what is not wrong — a staff that rests to the end, a bar line inside a bar, voices, checks written the model's way", () => {
  assert.deepEqual(only(remarks("<< \\new Staff { c'1\\p | c'1 } \\new Staff { c'1\\p } >>"), "bars"), []);
  // \\bar inside a bar ends it there, as the engraver does: a bar of its own length.
  assert.deepEqual(only(remarks("{ c'2\\p \\bar \"||\" d'2 e'2 | f'1 }"), "bars"), []);
  assert.deepEqual(only(remarks("\\new Staff << { c''4\\p d'' e'' f'' | g''1 } \\\\ { c'2 d'2 | e'1 } >>"), "bars"), []);
  // A bar check in a comment, or in words, is none.
  assert.deepEqual(only(remarks("{ c'4\\p d' % | e'\n e' f' | g'1^\"a | b\" }"), "bars"), []);
  // The model writes every bar whole: its text has nothing to say.
  const { score } = read("{ \\time 4/4 c'4\\p d' e' | f'1 | g'1 }");
  assert.deepEqual(read(M.toLilyPond(score).source).uneven, undefined);
  // And without the text (no `uneven`), nothing is said of the bars.
  assert.deepEqual(only(R.review(score), "bars"), []);
});

// ---- No dynamic to start --------------------------------------------------------------------

test("dynamic: the first note of a part with none is said; one on it, or on a rest before it, is enough", () => {
  const [none] = only(remarks("{ r2 c'2 | d'1 }"), "dynamic");
  assert.deepEqual([none.bar, none.t, none.level, none.text], [0, M.notated(2), "warning", "Piano: the first note has no dynamic"]);
  assert.deepEqual(only(remarks("{ r2 c'2\\mf | d'1 }"), "dynamic"), []);
  assert.deepEqual(only(remarks("{ r2\\mf c'2 | d'1 }"), "dynamic"), []);
  // A part of rests only says nothing.
  assert.deepEqual(only(remarks("{ r1 | r1 }"), "dynamic"), []);
});

test("dynamic: a dynamic carries on through the passage; after four bars of rest it is said again, after three it is not", () => {
  // Carried over: the notes after the first are under its p.
  assert.deepEqual(only(remarks("{ c'4\\p d' e' f' | g'1 | a'1 }"), "dynamic"), []);
  const back = only(remarks("{ c'1\\p | r1 | r1 | r1 | r1 | d'1 }"), "dynamic");
  assert.deepEqual(back.map((r) => [r.bar, r.text]), [[5, "Piano: comes back after 4 bars of rest with no dynamic"]]);
  assert.deepEqual(only(remarks("{ c'1\\p | r1 | r1 | r1 | d'1 }"), "dynamic"), []);
  assert.deepEqual(only(remarks("{ c'1\\p | r1 | r1 | r1 | r1 | d'1\\f }"), "dynamic"), []);
  // A note tied into the rest is still sounding: the bar it ends in is no bar of rest.
  assert.deepEqual(only(remarks("{ c'1\\p~ | c'4 r2. | r1 | r1 | r1 | d'1 }"), "dynamic"), []);
});

test("dynamic: a piano's two staves share their dynamics; two instruments do not", () => {
  const piano = "\\new PianoStaff << \\new Staff \\with { midiInstrument = \"acoustic grand\" } { c''1\\p } \\new Staff \\with { midiInstrument = \"acoustic grand\" } { \\clef bass c1 } >>";
  assert.deepEqual(only(remarks(piano), "dynamic"), []);
  const duo = `<< ${staff("Flute", "flute", "c''1\\p")} ${staff("Oboe", "oboe", "c''1")} >>`;
  assert.deepEqual(only(remarks(duo), "dynamic").map((r) => [r.lane, r.text]), [[1, "Oboe: the first note has no dynamic"]]);
});

// ---- Set aside -------------------------------------------------------------------------------

test("ignore: a remark set aside is kept on the settings line, read back from the text, and shown again", () => {
  const { score } = read("<< \\new Staff { c'1 } \\new Staff \\with { midiInstrument = \"violin\" } { f1\\p } >>");
  const before = R.review(score);
  assert.deepEqual(before.map((r) => [r.lane, r.rule, r.ignored]), [[0, "dynamic", false], [1, "range", false]]);
  const range = before[1];
  M.setReviewIgnored(score, range.lane, range.id, true);
  assert.deepEqual(score.meta.review, { 1: [range.id] });
  // Written into the text and read back, as a reload or a shared link reads it.
  const text = M.toLilyPond(score).source;
  assert.match(text, /%% eui-score .*"review":\{"1":\["low:0"\]\}/);
  const back = read(text).score;
  M.attachMeta(back, text);
  assert.deepEqual([...M.reviewIgnored(back)], ["1/low:0"]);
  assert.deepEqual(R.review(back).map((r) => [r.rule, r.ignored]), [["dynamic", false], ["range", true]]);
  // Shown again: the key goes with its last remark.
  M.setReviewIgnored(back, 1, "low:0", false);
  assert.equal(back.meta.review, undefined);
  assert.equal(R.review(back).filter((r) => r.ignored).length, 0);
});

test("ignore: what is not a remark is refused, and what does not read is left out of the line", () => {
  const { score } = read("{ c'1 }");
  assert.throws(() => M.setReviewIgnored(score, 3, "low:0", true), /no such staff/);
  assert.throws(() => M.setReviewIgnored(score, 0, "Low:0", true), /no such remark/);
  assert.throws(() => M.setReviewIgnored(score, 0, "low:x", true), /no such remark/);
  assert.equal(score.meta?.review, undefined);
  const read2 = M.readMetaLines(`{ c'1 }\n%% eui-score {"review":{"0":["low:0",7,"x"],"a":["low:0"],"1":[]}}\n`);
  assert.deepEqual(read2.meta.review, { 0: ["low:0"] });
});

test("review: no score, no remarks; every remark has its place, rule, level and words", () => {
  assert.deepEqual(R.review(null), []);
  assert.deepEqual(R.review({ staves: [] }), []);
  const list = remarks(`<< ${staff("Violin", "violin", "c'4 d' e' | f1")} >>`);
  for (const remark of list) {
    assert.ok(R.RULES.includes(remark.rule));
    assert.ok(["error", "warning", "hint"].includes(remark.level));
    assert.match(remark.id, /^[a-z]+:\d+$/);
    assert.ok(remark.text.startsWith("Violin: "));
    assert.notEqual(R.ruleTitle(remark.rule), remark.rule);
  }
  assert.deepEqual(list.map((r) => r.rule), ["bars", "dynamic", "range"].sort((a, b) => R.RULES.indexOf(a) - R.RULES.indexOf(b)));
});

test("names: pitches and keys said in English and in French, French counting middle C as do3", () => {
  assert.equal(R.pitchWord({ d: 7, alter: 0 }), "C4");
  assert.equal(R.pitchWord({ d: 10, alter: 1 }), "F♯4");
  assert.equal(R.keyWord(70), "B♭4");
  assert.equal(inFrench(() => R.pitchWord({ d: 7, alter: 0 })), "do3");
  assert.equal(inFrench(() => R.keyWord(52)), "mi2");
  assert.deepEqual(R.writtenShift({ instrument: "clarinet", name: "Clarinet in B♭" }), { steps: 1, semitones: 2 });
  assert.deepEqual(R.writtenShift({ instrument: "baritone sax", name: "" }), { steps: 12, semitones: 21 });
  assert.deepEqual(R.writtenShift({ instrument: "trumpet", name: "Trumpet in D" }), { steps: -1, semitones: -2 });
  assert.equal(R.writtenShift({ instrument: "flute", name: "Flute" }), null);
});
