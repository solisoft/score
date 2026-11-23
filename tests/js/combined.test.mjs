// Two parts on one staff (\partCombine) and one voice over a piano's two
// staves (\autoChange), edited on the score (#413); a \tweak on what follows
// a note kept with it. The engraver (the pinned wasm) draws them: every test
// engraves the model's text and checks that the notes it draws are those the
// model says it draws, so that a click on a drawn note finds its event.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);
const pitch = (d, alter = 0) => ({ rest: false, pitches: [{ d, alter }] });

/** The engraver's reading of a text, with where each note is written, as the studio asks for it. */
function withSpans(text) {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return parsed;
}

/** `src` read as the page reads it; a text the engraver refuses is read the model's way only. */
function parse(src) {
  let parsed = null;
  try {
    parsed = withSpans(src);
  } catch {}
  return M.fromParsed(parsed, src, { parse: withSpans });
}

function read(src) {
  const result = parse(src);
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result.score;
}

/** The model engraved: the items the engraver draws are exactly those the model says it draws. */
function engrave(score) {
  const { source, items } = M.toLilyPond(score);
  let view;
  try {
    view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  } catch (e) {
    throw new Error(`${e.message ?? e}\n${source}`);
  }
  const drawn = items.map((it, k) => (M.isDrawn(score, it) ? k : -1)).filter((k) => k >= 0);
  assert.deepEqual(view.items.map((it) => it.item).sort((x, y) => x - y), drawn, `the engraver draws what the model says\n${source}`);
  assert.ok(items.every((it) => score.staves[it.staff]?.events[it.index]), "every item is an event of the model");
  return { source, items, view };
}

/** Read, written, read again: the same text, the same staves. */
function roundTrip(src) {
  const score = read(src);
  const { source } = engrave(score);
  const again = read(source);
  assert.equal(engrave(again).source, source, "written again the same");
  const plain = (s) => JSON.stringify(s.staves.map((st) => ({ ...st, events: st.events.map(({ id, tuplet, ...ev }) => ({ ...ev, tuplet: tuplet && [tuplet.n, tuplet.d] })) })));
  assert.equal(plain(again), plain(score), "the same staves read back");
  return { score, source };
}

const notes = (score, s) => score.staves[s].events.map((ev) => (ev.rest ? (ev.spacer ? "s" : "r") : ev.pitches.map((p) => M.spellPitch(p.d, p.alter)).join("+")) + ev.base + ".".repeat(ev.dots));

// ---- \partCombine ------------------------------------------------------------------------

const HORNS = `\\new Staff \\with { instrumentName = "Horns" } {
  \\clef treble \\key f \\major \\time 3/4
  \\partCombine { c''4 d'' e''8 f'' | f''2. | g''2 r4 } { a'4 d'' c'' | r2. | r2 a'4 }
}`;

test("\\partCombine: its two parts are the staff's voices 1 and 2, every note and rest of each, written back as two parts", () => {
  const { score, source } = roundTrip(HORNS);
  assert.ok(M.isCombined(score, 0) && M.isCombined(score, 1));
  assert.equal(M.partOfLane(score, 0), 1);
  assert.equal(M.partOfLane(score, 1), 2);
  assert.equal(M.isRaw(score, 0), false, "not kept as written: edited");
  assert.deepEqual(notes(score, 0), ["c''4", "d''4", "e''8", "f''8", "f''2.", "g''2", "r4"]);
  assert.deepEqual(notes(score, 1), ["a'4", "d''4", "c''4", "r2.", "r2", "a'4"]);
  assert.equal(score.staves[0].name, "Horns");
  assert.match(source, /\\clef treble \\key f \\major \\time 3\/4\n {2}\\partCombine \{ c''4 d''4 e''8 f''8 \| f''2\. \| g''2 r4 \}\n {2}\{ a'4 d''4 c''4 \| r2\. \| r2 a'4 \} \\bar "\|\."/);
  // Nothing the engraver says over the notes (a2, Solo) is read as the score's words.
  assert.ok(score.staves.every((st) => st.events.every((ev) => !ev.texts.length)));
});

test("\\partCombine: a note drawn once for both parts is part I's; part II's is lit through it", () => {
  const score = read(HORNS);
  const { items, view } = engrave(score);
  const itemOf = (s, i) => items.findIndex((it) => it.staff === s && it.index === i);
  // Beat 2: d'' in both parts (a2), one note drawn — part I's.
  const one = itemOf(0, 1);
  const two = itemOf(1, 1);
  assert.ok(view.items.some((it) => it.item === one));
  assert.ok(!view.items.some((it) => it.item === two));
  assert.equal(items[two].hidden, true);
  assert.equal(M.drawnItem(items, two), one, "selecting part II's d'' lights the d'' drawn");
  // Beat 1: c'' over a', one chord: part I's note stands for both, its heads both pitches.
  const chord = view.items.find((it) => it.item === itemOf(0, 0));
  assert.deepEqual(chord.heads.map((h) => h.d).sort(), [12, 14]);
  assert.equal(M.drawnItem(items, itemOf(1, 0)), itemOf(0, 0));
  // Beat 3: e'' f'' over c'', in different rhythms: two voices, each drawn.
  assert.ok(view.items.some((it) => it.item === itemOf(0, 2)) && view.items.some((it) => it.item === itemOf(1, 2)));
  assert.equal(M.drawnItem(items, itemOf(1, 2)), itemOf(1, 2));
  // Bar 2: part I alone ("Solo"): part II's rest is not drawn, lit through part I's note.
  assert.equal(items[itemOf(1, 3)].hidden, true);
  assert.equal(M.drawnItem(items, itemOf(1, 3)), itemOf(0, 4));
  // Bar 3: part I plays, then part II alone ("Solo II"): part I's rest is not drawn, part II's a' is.
  assert.equal(items[itemOf(0, 6)].hidden, true);
  assert.equal(M.drawnItem(items, itemOf(0, 6)), itemOf(1, 5));
});

test("\\partCombine: each part edited on the score — a note, an articulation, a deletion, copy and paste, an undo", () => {
  const score = read(HORNS);
  // Part II's a2 note made its own: drawn now, beside part I's.
  M.setPitch(score, 1, 1, { d: 13, alter: 0 });
  M.toggleArticulation(score, 1, 1, "accent");
  let { source, items, view } = engrave(score);
  assert.match(source, /\{ a'4 b'4-> c''4 \|/);
  // Now under part I's d'': one chord, its heads both parts' pitches.
  const chord = view.items.find((it) => it.item === items.findIndex((x) => x.staff === 0 && x.index === 1));
  assert.deepEqual(chord.heads.map((h) => h.d).sort(), [13, 15]);
  assert.equal(items.find((x) => x.staff === 1 && x.index === 1).hidden, true);
  // Part I's first note taken away: a rest in its place.
  M.remove(score, 0, 0);
  ({ source } = engrave(score));
  assert.match(source, /\\partCombine \{ r4 d''4 e''8 f''8/);
  // Part I's first bar copied over part II's second: part II only.
  const before = M.toLilyPond(score).source;
  const snapshot = JSON.stringify(score);
  const clip = M.copy(score, 0, 0, 3);
  M.paste(score, 1, M.barStart(score, 1), clip);
  ({ source } = engrave(score));
  assert.deepEqual(notes(score, 1).slice(3, 7), ["r4", "d''4", "e''8", "f''8"]);
  assert.match(source, /\\partCombine \{ r4 d''4 e''8 f''8 \| f''2\. \|/, "part I unchanged");
  // Undo (the studio keeps the model as JSON): written as it was.
  assert.equal(M.toLilyPond(JSON.parse(snapshot)).source, before);
  // Read back from its text: the same parts.
  assert.deepEqual(notes(read(source), 1), notes(score, 1));
});

test("\\partCombine: bars put in and taken away, a new metre, the piece transposed, a note moved in the MIDI view — both parts follow", () => {
  let score = read(HORNS);
  M.insertBars(score, 1, 1);
  let { source } = engrave(score);
  assert.match(source, /\\partCombine \{ c''4 d''4 e''8 f''8 \| r2\. \| f''2\./);
  assert.match(source, /\{ a'4 d''4 c''4 \| r2\. \| r2\. \|/);
  M.deleteBars(score, 0, 1);
  ({ source } = engrave(score));
  assert.match(source, /\\partCombine \{ f''2\. \| g''2 r4 \}\n {2}\{ r2\. \| r2 a'4 \}/);
  score = read(HORNS);
  M.setTimeAt(score, 1, 2, 4);
  ({ source } = engrave(score));
  assert.match(source, /\| \\time 2\/4 f''2~ \| f''4/);
  assert.equal(M.lengthOf(score.staves[0]), M.lengthOf(score.staves[1]));
  score = read(HORNS);
  M.transpose(score, { steps: 1, semitones: 2 });
  ({ source } = engrave(score));
  assert.match(source, /\\key g \\major/);
  assert.match(source, /\\partCombine \{ d''4 e''4 fis''8 g''8/);
  assert.match(source, /\{ b'4 e''4 d''4/);
  // Part II alone, transposed down a step.
  M.transpose(score, { steps: -1, semitones: -2, s: 1 });
  assert.match(engrave(score).source, /\{ a'4 d''4 c''4/);
  // The MIDI view drags part II's first note up a semitone.
  score = read(HORNS);
  M.moveNote(score, 1, 0, { semitones: 1 });
  assert.match(engrave(score).source, /\{ bes'4 d''4/);
});

test("\\partCombine \\hornI \\hornII: the variables kept, their music the parts as edited", () => {
  const src = `hornI = \\relative c'' { c4 d e f | g1 }
hornII = \\relative c' { a4 b c2 | g'1 }
<<
  \\new Staff \\with { instrumentName = "Horns" } { \\partCombine \\hornI \\hornII }
  \\new Staff { \\clef bass c2 d | e1 }
>>`;
  const { score, source } = roundTrip(src);
  assert.deepEqual(score.staves[0].combine, { names: ["hornI", "hornII"] });
  assert.match(source, /^hornI = \{\n {2}c''4 d''4 e''4 f''4 \| g''1\n\}\nhornII = \{\n {2}a4 b4 c'2 \| g'1\n\}\n/);
  assert.match(source, /\\partCombine \\hornI \\hornII \\bar "\|\."/);
  M.write(score, 1, 0, q, pitch(9));
  const after = engrave(score).source;
  assert.match(after, /hornII = \{\n {2}e'4 b4 c'2/);
  assert.match(after, /\\partCombine \\hornI \\hornII/);
  // The other staff is written as before.
  assert.match(after, /\\clef bass \\key c \\major \\time 4\/4\n {4}c2 d2 \| e1/);
});

test("\\partCombine in a variable, `music = \\partCombine \\sop \\alt`, which the engraver alone does not read: edited, written out", () => {
  const src = `sop = \\relative c'' { c4 d e f | g1 }
alt = \\relative c' { a4 b c2 | g'1 }
music = \\partCombine \\sop \\alt
\\new Staff \\with { instrumentName = "Oboes" } \\music`;
  assert.throws(() => score_json(src), /partCombine/, "the engraver refuses this text by itself");
  const score = read(src);
  assert.ok(M.isCombined(score, 0));
  M.write(score, 0, 0, q, pitch(15));
  const { source } = engrave(score);
  assert.match(source, /sop = \{\n {2}d''4 d''4 e''4 f''4 \| g''1\n\}/);
  assert.match(source, /\\new Staff \\with \{ instrumentName = "Oboes" \} \{\n {2}\\clef treble \\key c \\major \\time 4\/4\n {2}\\partCombine \\sop \\alt/);
  assert.doesNotMatch(source, /music =/);
  // In braces the engraver reads it too: the same model.
  const braced = read("m = { \\partCombine { c''4 d'' e'' f'' } { a'4 b' c''2 } }\n\\new Staff \\m");
  assert.deepEqual(notes(braced, 1), ["a'4", "b'4", "c''2"]);
});

test("\\partCombine: what the score cannot do there is refused, said, and changes nothing", () => {
  const score = read(HORNS);
  const was = M.toLilyPond(score).source;
  assert.throws(() => M.addVoice(score, 0, 3), /two parts, part I and part II/);
  assert.throws(() => M.removeVoice(score, 1), /two parts, part I and part II/);
  assert.throws(() => M.setCross(score, 0, 0, 0, 1), /stay on their staff/);
  assert.throws(() => M.setLyric(score, 0, 0, "la"), /Words go under a staff of one part/);
  assert.equal(M.toLilyPond(score).source, was);
  // What the model cannot take apart stays kept as written, its notes edited in the text — with the reason.
  for (const src of [
    "\\new Staff \\partCombineUp { c''4 d'' e'' f'' } { a'4 b' c''2 }",
    // A command with no note of its part after it: where it holds cannot be said.
    "\\new Staff \\partCombine { c''4 d'' e'' f'' \\partCombineApart } { a'4 b' c''2 }",
    "\\new Staff \\partCombine { \\voiceOne c''4 d'' e'' f'' } { a'4 b' c''2 }",
    "\\new Staff { c''4 d'' e'' f'' | \\partCombine { c''4 d'' e'' f'' } { a'4 b' c''2 } }",
  ]) {
    const result = parse(src);
    assert.ok(result.score, `${src}: ${result.unsupported}`);
    assert.equal(M.isCombined(result.score, 0), false, src);
    assert.throws(() => M.write(result.score, 0, 0, q, pitch(12)), /kept as LilyPond wrote it/, src);
  }
});

test("combinedShown: unison, chords, solos, rests and parts apart, as the engraver's part combiner draws them", () => {
  const ev = (d, base = 4, fields = {}) => M.makeEvent({ rest: d == null, pitches: d == null ? [] : [{ d, alter: 0 }], base, ...fields });
  // a2, a chord, a third apart in rhythm, a solo, both resting.
  const one = [ev(14), ev(14), ev(16), ev(16, 8), ev(15, 8), ev(17), ev(null)];
  const two = [ev(14), ev(12), ev(12, 2), ev(null), ev(null)];
  const [shownI, shownII] = M.combinedShown(one, two);
  assert.deepEqual(shownI, [true, true, true, true, true, true, true]);
  assert.deepEqual(shownII, [false, false, true, false, false]);
  // Part I resting while part II plays: part II's notes, part I's rest not drawn; spacers never.
  const [i2, ii2] = M.combinedShown([ev(null, 2), ev(null, 2, { spacer: true })], [ev(9, 2), ev(null, 2)]);
  assert.deepEqual(i2, [false, false]);
  assert.deepEqual(ii2, [true, true]);
  // Too far apart for one chord: two voices.
  const [i3, ii3] = M.combinedShown([ev(21)], [ev(7)]);
  assert.deepEqual([i3, ii3], [[true], [true]]);
});

// ---- How the two parts are set: \partCombineApart and its kin (#1021) ----------------------

/** What the engraver draws of a text: each note and rest, its length, its voice, the words over it. */
const drawing = (text) => JSON.stringify(JSON.parse(score_json(text)).staves.map((st) => st.events.filter((ev) => ev.k === "Note" || ev.k === "Rest").map((ev) => [ev.k, ev.pitches, ev.ticks, ev.texts.map((t) => t[0]), ev.voice ?? 0])));

function engraves(source) {
  assert.doesNotThrow(() => editor_view(source, 900, 7, -1, -1), source);
}

const MODES = `hornI = \\relative c'' { c4 d \\partCombineApart e f | \\partCombineAutomatic g1 | c,4 \\partCombineUnisono d e f }
hornII = \\relative c'' { \\partCombineSoloI a4 b c2 | g1 | \\partCombineSoloII c4 d e \\partCombineChords d }
\\new Staff \\with { instrumentName = "Horns" } { \\partCombine \\hornI \\hornII }`;

test("\\partCombineApart, SoloI, SoloII, Unisono, Chords, Automatic: held by the model, part I saying them, and drawn as the text was", () => {
  const { score, source } = roundTrip(MODES);
  assert.ok(M.isCombined(score, 0), "edited on the score, not kept as written");
  assert.equal(M.isRaw(score, 0), false);
  // Part II's commands are said by part I, on its first note at or after each: the engraver heeds them there.
  assert.deepEqual(score.staves[0].events.map((ev) => ev.combineMode ?? "-"), ["soloI", "-", "apart", "-", "automatic", "soloII", "unisono", "-", "chords"]);
  assert.ok(score.staves[1].events.every((ev) => ev.combineMode == null));
  assert.match(source, /hornI = \{\n {2}\\partCombineSoloI c''4 d''4 \\partCombineApart e''4 f''4 \| \\partCombineAutomatic g''1 \| \\partCombineSoloII c''4 \\partCombineUnisono d''4 e''4 \\partCombineChords f''4\n\}/);
  assert.doesNotMatch(source.split("hornII = ")[1], /partCombine[A-Z]/, "part II says none");
  // The engraver draws the model's text as it drew the one read: the same notes, voices, Solo and a2.
  assert.equal(drawing(source), drawing(MODES));
  assert.match(drawing(source), /"Solo"/);
  assert.match(drawing(source), /"Solo II"/);
  assert.match(drawing(source), /"a2"/);
  for (const [i, mode] of [[0, "soloI"], [1, "soloI"], [2, "apart"], [4, "automatic"], [5, "soloII"], [8, "chords"]]) assert.equal(M.combineModeAt(score, 0, i), mode, `at ${i}`);
});

test("\\partCombine… commands: in braces, before a rest or a grace note, spelled \\partcombine — the same drawing; one in a string or a comment is not one", () => {
  for (const src of [
    "\\new Staff \\partCombine { c''4 \\partCombineApart d'' e'' f'' | g''1 } { c''4 d'' e'' f'' | \\partCombineAutomatic g''1 }",
    "\\new Staff \\partCombine { \\partCombineSoloII c''2 r | \\partCombineAutomatic \\grace b'8 c''1 } { a'2 a' | c''1 }",
    "\\new Staff \\partcombine { \\partcombineApart c''4 d'' e'' f'' } { a'4 b' c''2 }",
  ]) {
    const { score, source } = roundTrip(src);
    assert.ok(M.isCombined(score, 0), src);
    assert.ok(score.staves[0].events.some((ev) => ev.combineMode), src);
    assert.equal(drawing(source), drawing(src), src);
  }
  // In a string or a comment: read as none.
  const quoted = read("\\new Staff \\partCombine { c''4^\"partCombineApart\" d'' e'' f'' } { c''4 d'' % \\partCombineSoloI\n e'' f'' }");
  assert.ok(M.isCombined(quoted, 0));
  assert.ok(quoted.staves.every((st) => st.events.every((ev) => ev.combineMode == null)));
});

test("combinedShown: a command in force sets the stretch — apart, a2, a solo, a chord — as the engraver's `forced` does", () => {
  const ev = (d, base = 4, fields = {}) => M.makeEvent({ rest: d == null, pitches: d == null ? [] : [{ d, alter: 0 }], base, ...fields });
  const shown = (one, two) => M.combinedShown(one, two).map((flags) => flags.map(Number).join(""));
  // The same note in both: one drawn — two when apart.
  assert.deepEqual(shown([ev(14), ev(14)], [ev(14), ev(14)]), ["11", "00"]);
  assert.deepEqual(shown([ev(14, 4, { combineMode: "apart" }), ev(14)], [ev(14), ev(14)]), ["11", "11"]);
  // Apart holds until another says otherwise; both resting, part I's rest still.
  assert.deepEqual(shown([ev(14, 4, { combineMode: "apart" }), ev(null), ev(14, 4, { combineMode: "automatic" })], [ev(14), ev(null), ev(14)]), ["111", "100"]);
  // Different notes forced as one (a2): part I's drawn; a solo of part II: part II's, whatever part I plays.
  assert.deepEqual(shown([ev(16, 4, { combineMode: "unisono" }), ev(16, 4, { combineMode: "soloII" })], [ev(9), ev(9)]), ["10", "01"]);
  // a2 where part I rests and part II plays: part II's.
  assert.deepEqual(shown([ev(null, 4, { combineMode: "unisono" })], [ev(9)]), ["0", "1"]);
  // A chord forced where the parts are too far apart for one; not where their rhythms differ.
  assert.deepEqual(shown([ev(21, 4, { combineMode: "chords" }), ev(21, 8), ev(21, 8)], [ev(7), ev(7)]), ["111", "01"]);
  // Part II's command counts too, the later one winning at the same moment.
  assert.deepEqual(shown([ev(14, 4, { combineMode: "apart" })], [ev(14, 4, { combineMode: "soloI" })]), ["1", "0"]);
});

test("setCombineMode: a passage set apart, a2 or solo — what follows as it was — on either part's selection; refusals change nothing", () => {
  const score = read(HORNS);
  const plainText = engrave(score).source;
  // Bar 1 (c'' d'' e''8 f''8 over a' d'' c''): apart, then as the notes ask from bar 2 on.
  M.setCombineMode(score, 0, 0, 3, "apart");
  assert.deepEqual(score.staves[0].events.map((ev) => ev.combineMode ?? "-"), ["apart", "-", "-", "-", "automatic", "-", "-"]);
  const { source, items } = engrave(score);
  assert.match(source, /\\partCombine \{ \\partCombineApart c''4 d''4 e''8 f''8 \| \\partCombineAutomatic f''2\. \|/);
  // The d'' both play, drawn once before, is now drawn for each part.
  assert.ok(!items.find((it) => it.staff === 1 && it.index === 1).hidden);
  // Read back: the same.
  assert.deepEqual(read(source).staves[0].events.map((ev) => ev.combineMode ?? "-"), ["apart", "-", "-", "-", "automatic", "-", "-"]);
  // A selection in part II (its second and third notes) sets the passage from part I's note there.
  M.setCombineMode(score, 1, 1, 2, "soloI");
  assert.deepEqual(score.staves[0].events.map((ev) => ev.combineMode ?? "-"), ["apart", "soloI", "-", "-", "automatic", "-", "-"]);
  assert.match(drawing(engrave(score).source), /"Solo"/);
  // As the notes ask everywhere: the commands are gone, the text as it was.
  M.setCombineMode(score, 0, 0, 6, "automatic");
  assert.equal(engrave(score).source, plainText);
  // Refusals, each said, nothing changed.
  assert.throws(() => M.setCombineMode(score, 0, 0, 1, "together"), /as the notes ask, apart, as a chord, a2/);
  assert.throws(() => M.setCombineMode(score, 0, 0, 99, "apart"), /no such note/);
  assert.equal(M.toLilyPond(score).source, plainText);
  // A selection in which part I starts nothing: its whole note under part II's second half.
  const long = read("\\new Staff \\partCombine { c''1 } { a'2 b'2 }");
  const was = M.toLilyPond(long).source;
  assert.throws(() => M.setCombineMode(long, 1, 1, 1, "apart"), /Part I starts no note in the selection/);
  assert.equal(M.toLilyPond(long).source, was);
  const one = read("\\new Staff { c''4 d'' e'' f'' }");
  assert.throws(() => M.setCombineMode(one, 0, 0, 1, "apart"), /holds one part: condense it/);
});

test("a \\partCombine… command goes with its notes: the note under it rewritten, its bar deleted", () => {
  const score = read(HORNS);
  M.setCombineMode(score, 0, 4, 4, "apart");
  assert.deepEqual(score.staves[0].events.map((ev) => ev.combineMode ?? "-"), ["-", "-", "-", "-", "apart", "automatic", "-"]);
  // The note under the command rewritten: the command holds there still.
  M.write(score, 0, M.starts(score.staves[0])[4], M.notated(2, 1), pitch(20));
  assert.equal(M.combineModeAt(score, 0, 4), "apart");
  assert.equal(M.combineModeAt(score, 0, 5), "automatic");
  engrave(score);
  // Its bar deleted: nothing of it left, what held after it holds there still.
  M.deleteBars(score, 1, 1);
  assert.ok(score.staves[0].events.every((ev) => (ev.combineMode ?? "automatic") === "automatic"), JSON.stringify(score.staves[0].events.map((ev) => ev.combineMode)));
  engrave(score);
});

// ---- Two staves condensed on one, and split again (#1021) --------------------------------

const FLUTES = `<<
  \\new Staff \\with { instrumentName = "Flute 1" shortInstrumentName = "Fl. 1" midiInstrument = "flute" } { \\key g \\major c''4 d'' e'' f'' | g''1 | r1 }
  \\new Staff \\with { instrumentName = "Flute 2" shortInstrumentName = "Fl. 2" midiInstrument = "piccolo" } { \\key g \\major c''4 b' c'' d'' | r1 | e''1 }
  \\new Staff \\with { instrumentName = "Bassoon" midiInstrument = "bassoon" } { \\clef bass \\key g \\major c1 | d | e }
>>`;

/** FLUTES read, with a mixer setting on each lane and a break of its own in the second flute's part. */
function flutes() {
  const score = read(FLUTES);
  score.meta = { mixer: { tracks: { 0: { volume: 0.5 }, 1: { volume: 0.8 }, 2: { pan: -0.3 } } } };
  M.setPartBreak(score, 1, 0, "line");
  return score;
}

/** The model's text read again as the page reads it, its settings line with it. */
function reread(score) {
  const { source } = M.toLilyPond(score);
  const again = read(source);
  M.attachMeta(again, source);
  return again;
}

test("condenseStaves: a staff and the one below it as the two parts of \\partCombine, variables named after them; splitStaves undoes it, to the letter", () => {
  const score = flutes();
  const before = M.toLilyPond(score).source;
  assert.equal(M.condenseStaves(score, 0), 0);
  const { source } = engrave(score);
  assert.match(source, /^fluteI = \{\n {2}c''4 d''4 e''4 f''4 \| g''1 \| r1\n\}\nfluteII = \{\n {2}c''4 b'4 c''4 d''4 \| r1 \| e''1\n\}\n/);
  assert.match(source, /\\new Staff \\with \{ instrumentName = "Flute 1\.2" shortInstrumentName = "Fl\. 1\.2" midiInstrument = "flute" \} \{\n {4}\\clef treble \\key g \\major \\time 4\/4\n {4}\\partCombine \\fluteI \\fluteII/);
  assert.deepEqual(M.staffLanes(score), [0, 2], "two staves now");
  assert.ok(M.isCombined(score, 0) && M.partOfLane(score, 1) === 2);
  // The engraver marks them itself: a2 where they play as one, Solo where one rests.
  assert.match(drawing(source), /"a2"/);
  assert.match(drawing(source), /"Solo"/);
  // What the settings line keeps by lane stays with its notes; what each desk was is kept for Split.
  assert.deepEqual(score.meta.mixer.tracks, { 0: { volume: 0.5 }, 1: { volume: 0.8 }, 2: { pan: -0.3 } });
  assert.deepEqual(score.meta.desks, { 0: { names: ["Flute 1", "Flute 2"], shorts: ["Fl. 1", "Fl. 2"], instruments: ["flute", "piccolo"] } });
  // Split: the text as it was before, to the letter — in memory, and from the saved text read again.
  const saved = reread(score);
  assert.deepEqual(M.splitStaves(score, 0), [0, 1]);
  assert.equal(M.toLilyPond(score).source, before);
  assert.ok(M.isCombined(saved, 0), "read back condensed");
  M.splitStaves(saved, 1);
  assert.equal(M.toLilyPond(saved).source, before);
  assert.equal(saved.meta.desks, undefined);
});

test("condenseStaves: what cannot share a staff is refused, said, and nothing changes", () => {
  const refused = (src, pattern, s = 0) => {
    const score = parse(src).score;
    assert.ok(score, src);
    const was = JSON.stringify(score);
    assert.throws(() => M.condenseStaves(score, s), pattern, src);
    assert.equal(JSON.stringify(score), was, `nothing changed: ${src}`);
  };
  const pair = (a, b) => `<<\n  \\new Staff ${a}\n  \\new Staff ${b}\n>>`;
  refused(pair("{ c''4 d'' e'' f'' }", "{ \\clef bass c4 d e f }"), /different clefs/);
  refused(pair("{ c''4 d'' e'' f'' | \\clef alto g'1 }", "{ c''4 d'' e'' f'' | g'1 }"), /different clefs/);
  refused(pair("\\with { midiInstrument = \"clarinet\" } { c''4 d'' e'' f'' }", "\\with { midiInstrument = \"flute\" } { c''4 d'' e'' f'' }"), /same transposition/);
  refused(pair("\\with { instrumentName = \"Clarinet in A\" midiInstrument = \"clarinet\" } { c''1 }", "\\with { instrumentName = \"Clarinet in B♭\" midiInstrument = \"clarinet\" } { c''1 }"), /same transposition/);
  refused(pair("{ c''4 d'' e'' f'' } \\addlyrics { la la la la }", "{ c''4 d'' e'' f'' }"), /Words go under a staff of one part/);
  refused(pair("{ << { c''4 d'' e'' f'' } \\\\ { a'1 } >> }", "{ c''4 d'' e'' f'' }"), /second voice/);
  refused(pair("{ c''4 d'' e'' f'' }", "{ << { c''4 d'' e'' f'' } \\\\ { a'1 } >> }"), /second voice/);
  refused(pair("\\with { \\magnifyStaff #2/3 } { c''4 d'' e'' f'' }", "{ c''4 d'' e'' f'' }"), /not set alike/);
  refused("\\new Staff { c''4 d'' e'' f'' }", /No staff below this one/);
  refused(pair("{ c''4 d'' e'' f'' }", "{ c''4 d'' e'' f'' }"), /No staff below this one/, 1);
  refused(pair("{ c''4 d'' e'' f'' }", "{ c''4 d'' e'' f'' }"), /no such staff/, 9);
  refused("<<\n  \\new Staff { c''4 d'' e'' f'' }\n  \\new DrumStaff \\drummode { sn4 sn sn sn }\n>>", /Only two staves of notes/);
  refused(pair("\\partCombine { c''4 d'' e'' f'' } { a'4 b' c''2 }", "{ c''4 d'' e'' f'' }"), /two parts at most/);
  refused(pair("{ c''4 d'' e'' f'' | \\partCombine { c''4 d'' e'' f'' } { a'4 b' c''2 } }", "{ c''4 d'' e'' f'' | c''1 }"), /kept as LilyPond wrote it/);
  // A group that holds one of the two and not the other.
  refused("<<\n  \\new Staff { c''1 }\n  \\new StaffGroup <<\n    \\new Staff { c''1 }\n    \\new Staff { c''1 }\n  >>\n>>", /different groups/);
  // A staff in a key of its own, another metre drawn: set on the model, as the editor does.
  const keyed = read(pair("{ c''4 d'' e'' f'' }", "{ c''4 d'' e'' f'' }"));
  keyed.staves[1].key = 2;
  assert.throws(() => M.condenseStaves(keyed, 0), /different keys/);
  const timed = read(pair("{ c''4 d'' e'' f'' }", "{ c''4 d'' e'' f'' }"));
  timed.staves[1].shownTime = [2, 2];
  assert.throws(() => M.condenseStaves(timed, 0), /same bars/);
  assert.equal(M.isCombined(keyed, 0) || M.isCombined(timed, 0), false);
});

test("condenseStaves: names — the same instrument numbered, two instruments, none; variables no other staff uses; a group around both kept", () => {
  const named = (a, b) => {
    const score = read(`<<\n  \\new Staff \\with { instrumentName = "${a}" } { c''1 }\n  \\new Staff \\with { instrumentName = "${b}" } { a'1 }\n>>`);
    M.condenseStaves(score, 0);
    engrave(score);
    return [score.staves[0].name, ...score.staves[0].combine.names];
  };
  assert.deepEqual(named("Flute 1", "Flute 2"), ["Flute 1.2", "fluteI", "fluteII"]);
  assert.deepEqual(named("Flûte I", "Flûte II"), ["Flûte I.II", "fluteI", "fluteII"]);
  assert.deepEqual(named("Horn 3", "Horn 4"), ["Horn 3.4", "hornIII", "hornIV"]);
  assert.deepEqual(named("Oboe", "Oboe"), ["Oboe 1.2", "oboeI", "oboeII"]);
  assert.deepEqual(named("Flute", "Piccolo"), ["Flute / Piccolo", "fluteI", "piccoloII"]);
  // No name: parts I and II; a second pair takes names of its own.
  const score = read("<<\n  \\new Staff { c''1 }\n  \\new Staff { a'1 }\n  \\new Staff { c''1 }\n  \\new Staff { a'1 }\n>>");
  M.condenseStaves(score, 2);
  M.condenseStaves(score, 0);
  assert.deepEqual([score.staves[0].name, score.staves[0].combine.names, score.staves[2].combine.names], ["", ["partIx", "partIIx"], ["partI", "partII"]]);
  const { source } = engrave(score);
  assert.equal(engrave(reread(score)).source, source, "read back and written the same");
  // Two staves in a group of their own, and a group after them: the group is around the one staff, and both again.
  const grouped = read("<<\n  \\new StaffGroup <<\n    \\new Staff \\with { instrumentName = \"Horn 1\" } { c''1 }\n    \\new Staff \\with { instrumentName = \"Horn 2\" } { a'1 }\n  >>\n  \\new StaffGroup <<\n    \\new Staff { \\clef bass c1 }\n    \\new Staff { \\clef bass c1 }\n  >>\n>>");
  const before = M.toLilyPond(grouped).source;
  assert.deepEqual(grouped.groups.map((g) => [g.first, g.last]), [[0, 1], [2, 3]]);
  M.condenseStaves(grouped, 0);
  assert.deepEqual(grouped.groups.map((g) => [g.first, g.last]), [[0, 0], [1, 2]]);
  const again = reread(grouped);
  assert.deepEqual(again.groups.map((g) => [g.first, g.last]), [[0, 0], [1, 2]], "the group read back");
  M.splitStaves(again, 0);
  assert.equal(M.toLilyPond(again).source, before);
});

test("splitStaves: a \\partCombine written so splits too, each staff named after it, how the two were set forgotten; a plain staff is refused", () => {
  const score = read(MODES);
  assert.deepEqual(M.splitStaves(score, 0), [0, 1]);
  assert.deepEqual(M.staffLanes(score), [0, 1]);
  assert.deepEqual([score.staves[0].name, score.staves[1].name], ["Horns 1", "Horns 2"]);
  const { source } = engrave(score);
  assert.doesNotMatch(source, /partCombine|hornI/);
  assert.deepEqual(notes(score, 1), ["a'4", "b'4", "c''2", "g'1", "c''4", "d''4", "e''4", "d''4"]);
  assert.equal(score.staves[1].clef, "treble");
  // "Horns 1.2", as condensing names a pair: Horns 1 and Horns 2 again.
  const pair = read("\\new Staff \\with { instrumentName = \"Horns 1.2\" } \\partCombine { c''1 } { a'1 }");
  M.splitStaves(pair, 0);
  assert.deepEqual([pair.staves[0].name, pair.staves[1].name], ["Horns 1", "Horns 2"]);
  const was = JSON.stringify(score);
  assert.throws(() => M.splitStaves(score, 0), /only a staff of two parts splits/);
  assert.equal(JSON.stringify(score), was);
  const raw = parse("\\new Staff \\partCombineUp { c''4 d'' e'' f'' } { a'4 b' c''2 }").score;
  assert.throws(() => M.splitStaves(raw, 0), /kept as LilyPond wrote it/);
});

test("partList and partOf: on a staff of two parts each desk is a part — its notes alone on a plain staff, its rests gathered, its own name and layout", () => {
  const score = flutes();
  assert.deepEqual(M.partList(score).map((p) => [p.lane, p.desk, p.name]), [[0, 0, "Flute 1"], [1, 0, "Flute 2"], [2, 0, "Bassoon"]]);
  const alone = M.toLilyPond(M.partOf(score, 1), { written: true }).source;
  M.condenseStaves(score, 0);
  M.setCombineMode(score, 0, 0, 3, "apart");
  assert.deepEqual(M.partList(score).map((p) => [p.lane, p.desk, p.staff, p.name]), [[0, 1, 0, "Flute 1"], [1, 2, 0, "Flute 2"], [2, 0, 1, "Bassoon"]]);
  // The second desk's part: what its own staff's part was — its name, its sound, its mixer setting, its own break.
  const second = M.partOf(score, 1, 2);
  assert.equal(M.toLilyPond(second, { written: true }).source, alone);
  assert.match(alone, /\\header \{ instrument = "Flute 2" \}/);
  assert.match(alone, /midiInstrument = "piccolo"/);
  assert.match(alone, /c''4 b'4 c''4 d''4 \| \\break R1 \| e''1/);
  assert.doesNotMatch(alone, /partCombine|fluteI/);
  assert.deepEqual(second.meta, { mixer: { tracks: { 0: { volume: 0.8 } } } });
  // The first desk's: part I alone, nothing of how the two were set.
  const first = M.toLilyPond(M.partOf(score, 0, 1), { written: true }).source;
  assert.match(first, /\\header \{ instrument = "Flute 1" \}/);
  assert.match(first, /c''4 d''4 e''4 f''4 \| g''1 \| R1/);
  assert.doesNotMatch(first, /partCombine|\\break/);
  engraves(first);
  engraves(alone);
  // Each desk's layout is its own, kept by its lane: set on the second, the first's is as it was.
  M.setPartLayout(score, 1, { staffSize: 16 });
  M.setPartBreak(score, 0, 1, "page");
  assert.deepEqual(M.partLayout(score, 1), { breaks: { 0: "line" }, staffSize: 16, systemsPerPage: null, evenPages: null, systemSpacing: null });
  assert.deepEqual(M.partLayout(score, 0).breaks, { 1: "page" });
  assert.match(M.toLilyPond(M.partOf(score, 1, 2), { written: true }).source, /set-global-staff-size 16/);
  assert.doesNotMatch(M.toLilyPond(M.partOf(score, 0, 1), { written: true }).source, /set-global-staff-size/);
  // Through the saved text, and after Split: each staff keeps its desk's layout.
  const saved = reread(score);
  assert.deepEqual(saved.meta.parts, { 0: { breaks: { 1: "page" } }, 1: { breaks: { 0: "line" }, staffSize: 16 } });
  M.splitStaves(saved, 0);
  assert.equal(M.partLayout(saved, 1).staffSize, 16);
  // The whole staff, both desks on it, is still a part for who asks for no desk.
  assert.match(M.toLilyPond(M.partOf(score, 0), { written: true }).source, /\\partCombine/);
  // What is no part: a desk of a plain staff, a third desk; a voice of a plain staff has no layout of its own.
  assert.throws(() => M.partOf(score, 2, 1), /no such part/);
  assert.throws(() => M.partOf(score, 0, 3), /no such part/);
  const voices = read("\\new Staff { << { c''1 } \\\\ { a'1 } >> | c''1 }");
  assert.throws(() => M.setPartBreak(voices, 1, 0, "line"), /no such staff/);
  // A staff written \partCombine with no desks kept: named after the staff; with no name, the page names them.
  assert.deepEqual(M.partList(read(MODES)).map((p) => p.name), ["Horns 1", "Horns 2"]);
  assert.match(M.toLilyPond(M.partOf(read(MODES), 1, 2), { written: true }).source, /instrument = "Horns 2"/);
  assert.deepEqual(M.partList(read("\\new Staff \\partCombine { c''1 } { a'1 }")).map((p) => [p.lane, p.desk, p.name]), [[0, 1, ""], [1, 2, ""]]);
  // A desk's rests written in pieces, or as spacers, are whole bars in its part.
  const spaced = read("\\new Staff \\with { instrumentName = \"Oboes\" } \\partCombine { c''1 | d''1 | e''1 } { s2 s2 | r2 r2 | e''1 }");
  assert.match(M.toLilyPond(M.partOf(spaced, 0, 2), { written: true }).source, /R1\*2 \| e''1/);
});

// ---- \autoChange -------------------------------------------------------------------------

const PIANO = `\\new PianoStaff \\with { instrumentName = "Piano" } \\autoChange { c'4 g r a, | b' <c' e>2. }`;

test("\\autoChange: one voice, drawn over the piano's two staves; a click on either staff finds the voice's note", () => {
  const { score, source } = roundTrip(PIANO);
  assert.deepEqual(score.staves[0].autoChange, { piano: true });
  assert.equal(M.staffLanes(score).length, 1, "one staff in the model");
  assert.equal(score.staves[0].name, "Piano");
  assert.equal(source.trim(), `\\new PianoStaff \\with { instrumentName = "Piano" } \\autoChange {\n  \\key c \\major \\time 4/4\n  c'4 g4 r4 a,4 | b'4 <c' e>2. \\bar "|."\n}`);
  const { items, view } = engrave(score);
  // The voice's six events, then the lower staff's rest for each: drawn where the voice's note is up.
  assert.equal(items.length, 12);
  assert.deepEqual(items.slice(6).map((it) => [it.index, Boolean(it.hidden)]), [[0, false], [1, true], [2, false], [3, true], [4, false], [5, true]]);
  // g (under middle C) is drawn on the lower staff, below b' on the upper: a click there selects the voice's g.
  const g = view.items.find((it) => it.item === 1);
  const b = view.items.find((it) => it.item === 4);
  assert.ok(g.heads[0].box[1] > b.box[3], "g is drawn on the lower staff");
  assert.deepEqual(items[g.item], { staff: 0, index: 1 });
  // The lower staff's rest under c' stands for the voice's c'.
  assert.equal(items[view.items.find((it) => it.item === 6).item].index, 0);
});

test("\\autoChange: edits rewrite the voice inside \\autoChange; a note moved under middle C goes to the lower staff", () => {
  const score = read(PIANO);
  M.setPitch(score, 0, 0, { d: 3, alter: 0 });
  let { source, items, view } = engrave(score);
  assert.match(source, /\\autoChange \{\n {2}\\key c \\major \\time 4\/4\n {2}f4 g4 r4 a,4/);
  // Its rest on the lower staff now hidden, its note there.
  assert.equal(items[6].hidden, true);
  assert.ok(!view.items.some((it) => it.item === 6));
  M.insertBars(score, 1, 1);
  M.transpose(score, { steps: 1, semitones: 2 });
  ({ source } = engrave(score));
  assert.match(source, /\\key d \\major \\time 4\/4\n {2}g4 a4 r4 b,4 \| r1 \| cis''4 <d' fis>2\./);
  M.deleteBars(score, 1, 1);
  M.setTimeAt(score, 1, 3, 4);
  ({ source } = engrave(score));
  assert.match(source, /\| \\time 3\/4 cis''4 <d' fis>2~ \| <d' fis>4 r2/);
  assert.deepEqual(notes(read(source), 0), notes(score, 0));
});

test("\\autoChange: its split pitch, alone or in a variable, beside another staff; what it cannot hold refused", () => {
  const split = roundTrip("<< \\new Staff { \\clef bass c2 d | e1 } \\new PianoStaff \\autoChange g { c'4 g a b | c1 } >>");
  assert.deepEqual(split.score.staves[1].autoChange, { split: "g", piano: true });
  assert.match(split.source, /\\new PianoStaff \\autoChange g \{/);
  // Under g, not middle C: a (above g) stays up, so its lower rest is drawn.
  const { items } = engrave(split.score);
  assert.equal(items.find((it) => it.echo && it.index === 2).hidden, undefined);
  const alone = roundTrip("\\autoChange { c'4 g a b | c1 }");
  assert.deepEqual(alone.score.staves[0].autoChange, {});
  assert.match(alone.source, /^\\autoChange \{/);
  // In a variable the engraver refuses by itself: read, then written out.
  const src = "pianoMusic = \\autoChange \\relative c' { c4 g a, b' | c1 }\n\\score { \\new PianoStaff \\pianoMusic }";
  assert.throws(() => score_json(src), /autoChange/);
  const kept = read(src);
  assert.deepEqual(notes(kept, 0), ["c'4", "g4", "a,4", "b4", "c'1"]);
  assert.match(engrave(kept).source, /^\\new PianoStaff \\autoChange \{/);
  // Refused, said, nothing changed.
  const score = read(PIANO);
  const was = M.toLilyPond(score).source;
  assert.throws(() => M.addVoice(score, 0, 2), /one voice over the piano's two staves/);
  assert.throws(() => M.setClefAt(score, 0, 1, "bass"), /keeps its staves' clefs/);
  assert.throws(() => M.setCross(score, 0, 0, 0, 1), /no staff below|sends its notes/);
  assert.throws(() => M.setLyric(score, 0, 0, "la"), /Words go under a staff of one part/);
  assert.equal(M.toLilyPond(score).source, was);
  // Inside a staff of its own (\\change Staff written by hand around it): kept as written.
  const inStaff = parse("\\new PianoStaff << \\new Staff = \"up\" { s1 } \\new Staff = \"down\" { \\autoChange { c'4 g a b } } >>");
  assert.ok(!inStaff.score || !M.isAutoChange(inStaff.score, 0));
});

// ---- A \tweak on what follows a note --------------------------------------------------------

test("a \\tweak on an articulation, words, a dynamic, a fingering, a slur: kept with each through edits", () => {
  const src = "{ c'4-\\tweak color #red -> d'4 -\\tweak extra-offset #'(0 . 1) ^\"x\" e'2\\p-\\tweak X-offset #2 -. | f'1_\\tweak color #blue \\f-\\tweak color #red \\tweak font-size #3 -1( | g'1)-\\tweak color #red ^\\markup \\italic \"dolce\" }";
  const result = parse(src);
  assert.equal(result.lost, undefined, "nothing is lost");
  const { score, source } = roundTrip(src);
  assert.match(source, /c'4-\\tweak color #red -> d'4-\\tweak extra-offset #'\(0 \. 1\) \^"x" e'2\\p-\\tweak X-offset #2 -\. \| f'1\(_\\tweak color #blue \\f-\\tweak color #red \\tweak font-size #3 -1 \| g'1\)-\\tweak color #red \^\\markup \\italic "dolce"/);
  assert.deepEqual(score.staves[0].events[1].tweaks, [{ on: "text:x", lead: "-", text: "\\tweak extra-offset #'(0 . 1)" }]);
  // The note written over at another pitch, an articulation added: each tweak stays on what it tweaks.
  M.setPitch(score, 0, 0, { d: 12, alter: 0 });
  M.toggleArticulation(score, 0, 0, "staccato");
  M.transpose(score, { steps: 1, semitones: 2 });
  let after = engrave(score).source;
  assert.match(after, /b'4-\\tweak color #red ->-\. e'4-\\tweak extra-offset #'\(0 \. 1\) \^"x"/);
  // The accent taken away: its tweak with it; the accent again, plain.
  M.toggleArticulation(score, 0, 0, "accent");
  M.toggleArticulation(score, 0, 0, "accent");
  after = engrave(score).source;
  assert.match(after, /b'4-\.->/);
  assert.doesNotMatch(after, /color #red ->/);
  // Copied and pasted: the words' tweak goes along.
  const clip = M.copy(score, 0, 1, 1);
  M.paste(score, 0, M.barStart(score, 1), clip);
  assert.match(engrave(score).source, /\| e'4-\\tweak extra-offset #'\(0 \. 1\) \^"x"/);
});

test("a \\tweak before a note whose value is a pair, \\tweak extra-offset #'(0 . 1): its value whole, not a path", () => {
  const src = "{ \\once \\override NoteHead.color = #red \\tweak extra-offset #'(0 . 1) c'4 d'4 }";
  const at = src.indexOf("c'4");
  const kept = M.keptCommands(src, [[at, at + 3], [at + 4, at + 7]]);
  assert.deepEqual(kept.get(0), ["\\once \\override NoteHead.color = #red", "\\tweak extra-offset #'(0 . 1)"]);
  assert.equal(kept.get(1), undefined);
});
