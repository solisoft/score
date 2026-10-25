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
    "\\new Staff \\partCombine { \\partCombineApart c''4 d'' e'' f'' } { a'4 b' c''2 }",
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
