// The metre wherever it is written (#408): a \time inside a bar, a \partial
// after the first bar, a \time in one staff only, two metres side by side
// with bars as long (\scaleDurations, timeSignatureFraction, \enablePolymeter),
// voices inside a voice, and staves drawn smaller. The engraver reads them;
// the editor opens them on the score, writes them back to the same meaning,
// and its operations keep them or refuse with a reason.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);
const A4 = { rest: false, pitches: [{ d: 12, alter: 0 }] };

function withSpans(text) {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return parsed;
}

function read(src) {
  const result = M.fromParsed(withSpans(src), src, { parse: withSpans });
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result.score;
}

/** The model engraved: every item drawn is the model's, the bars as the model counts them. */
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
  assert.equal(new Set(view.bars.map((b) => b.bar)).size, M.barsOf(score), `as many bars drawn as the model counts\n${source}`);
  return { source, view };
}

/** Read, written, read again: the same text, the same bars. */
function roundTrip(src) {
  const score = read(src);
  const { source } = engrave(score);
  const again = read(source);
  assert.equal(engrave(again).source, source, "written again the same");
  assert.deepEqual(again.changes, score.changes, "the same bars");
  return { score, source };
}

const notes = (score, s) => score.staves[s].events.map((ev) => (ev.rest ? (ev.spacer ? "s" : "r") : M.spellPitch(ev.pitches[0].d, ev.pitches[0].alter)) + ev.base + ".".repeat(ev.dots));
const lengths = (score) => Array.from({ length: M.barsOf(score) }, (_, b) => M.barLength(score, b) / q);

// ---- A \time inside a bar ------------------------------------------------------------------

test("a \\time inside a bar: the bar ends when it is as long as the new metre, and is written back where it was", () => {
  const { score, source } = roundTrip("{ \\time 4/4 c'4 d'4 \\time 3/4 e'4 f'4 g'4 a'4 | b'2. }");
  // Bar 1: two beats of 4/4, then 3/4 — it ends after three beats; then bars of 3/4.
  assert.deepEqual(lengths(score), [3, 3, 3]);
  assert.deepEqual(M.timeAt(score, 1), [3, 4]);
  assert.match(source, /\\time 4\/4\n {2}c'4 d'4 \\time 3\/4 e'4 \| f'4 g'4 a'4 \| b'2\./);
  // Already as long as the new metre: the bar ends where the \time is, written before its bar line.
  const at = roundTrip("{ c'2 \\time 2/4 d'2 | e'2 }");
  assert.deepEqual(lengths(at.score), [2, 2, 2]);
  assert.match(at.source, /c'2 \\time 2\/4 \| d'2 \| e'2/);
});

test("a \\time inside a bar through edits: notes written, bars put in and taken away, transposed, the metre changed", () => {
  const src = "{ \\time 4/4 c'4 d'4 \\time 3/4 e'4 | f'4 g'4 a'4 | b'2. }";
  let score = read(src);
  M.write(score, 0, q, q, A4);
  assert.match(engrave(score).source, /c'4 a'4 \\time 3\/4 e'4 \|/);
  // A note written over the place of the \time: it can no longer be written there, so the bar is a \partial of its length.
  M.write(score, 0, 0, 3 * q, A4);
  let { source } = engrave(score);
  assert.match(source, /\\time 4\/4 \\partial 2\.\n {2}a'2\. \| \\time 3\/4 f'4/);
  assert.deepEqual(lengths(read(source)), [3, 3, 3]);
  // A bar put in after it keeps the metre before; the 3/4 moves along.
  score = read(src);
  M.insertBars(score, 1, 1);
  ({ source } = engrave(score));
  assert.deepEqual(lengths(score), [3, 4, 3, 3]);
  assert.match(source, /\\partial 2\.\n {2}c'4 d'4 e'4 \| r1 \| \\time 3\/4 f'4/);
  // The first bar taken away: the piece starts in 3/4.
  score = read(src);
  M.deleteBars(score, 0, 0);
  assert.deepEqual(score.time, [3, 4]);
  assert.deepEqual(lengths(score), [3, 3]);
  assert.match(engrave(score).source, /\\time 3\/4\n {2}f'4 g'4 a'4 \| b'2\./);
  // Transposed: the bars stay.
  score = read(src);
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(engrave(score).source, /d'4 e'4 \\time 3\/4 fis'4 \|/);
  // The metre changed from the menu on a later bar.
  M.setTimeAt(score, 2, 2, 4);
  ({ source } = engrave(score));
  assert.match(source, /\| \\time 2\/4 cis''2 \| r4 r4/);
  // Changing the bar the \time cut short: refused, said.
  assert.throws(() => M.setTimeAt(read(src), 0, 2, 4), /cadenza or a bar cut short/);
});

// ---- A \partial after the first bar ----------------------------------------------------------

test("a \\partial after the first bar: a bar that long, at a bar line or inside a bar, kept through edits", () => {
  const { score, source } = roundTrip("\\new Staff { \\partial 4 g4 | c'2 d'2 | \\partial 2 e'2 | f'1 }");
  assert.deepEqual(lengths(score), [1, 4, 2, 4]);
  assert.match(source, /\\partial 4\n {2}g4 \| c'2 d'2 \| \\partial 2 e'2 \| f'1/);
  const inside = roundTrip("{ c'2 \\partial 4 d'4 | e'1 }");
  // Half a bar played, then a quarter left: a bar of three beats.
  assert.deepEqual(lengths(inside.score), [3, 4]);
  assert.match(inside.source, /c'2 \\partial 4 d'4 \| e'1/);
  // Bars put in before it, the first taken away: the \partial stays with its bar.
  M.insertBars(inside.score, 1, 2);
  assert.deepEqual(lengths(inside.score), [3, 4, 4, 4]);
  M.deleteBars(inside.score, 1, 2);
  assert.match(engrave(inside.score).source, /c'2 \\partial 4 d'4 \| e'1/);
  // Copied and pasted over the bar after it: the notes go, the bar stays as long.
  const clip = M.copy(inside.score, 0, 0, 1);
  M.paste(inside.score, 0, M.barStart(inside.score, 1), clip);
  assert.match(engrave(inside.score).source, /c'2 \\partial 4 d'4 \| c'2 d'4 e'4/);
  // The first bar, made a pickup when the bar before it goes.
  const first = read("{ c'1 | \\partial 4 d'4 | e'1 }");
  M.deleteBars(first, 0, 0);
  assert.match(engrave(first).source, /\\partial 4\n {2}d'4 \| e'1/);
});

// ---- A \time in one staff only -----------------------------------------------------------------

test("a \\time written in one staff only is every staff's, even inside a bar of another", () => {
  const { score, source } = roundTrip("<< \\new Staff { c'1 | d'1 | e'2. } \\new Staff { c1 | \\time 3/4 d2. | e2. } >>");
  assert.deepEqual(lengths(score), [4, 3, 3, 3]);
  // The first staff's d'1 crosses into the next bar of 3/4: tied.
  assert.deepEqual(notes(score, 0).slice(1, 4), ["d'2.", "d'4", "e'2"]);
  assert.match(source, /c'1 \| \\time 3\/4 d'2\.~ \| d'4 e'2~/);
  const mid = roundTrip("<< \\new Staff { c'4 d'4 e'4 f'4 | g'2 a'2 | b'2 } \\new Staff { c2 \\time 2/4 d2 | e2 f2 | g2 } >>");
  assert.deepEqual(lengths(mid.score), [2, 2, 2, 2, 2]);
  // Written once, in the first staff, where the bar ends.
  assert.match(mid.source, /c'4 d'4 \\time 2\/4 \| e'4 f'4 \| g'2/);
  assert.equal((mid.source.match(/\\time 2\/4/g) ?? []).length, 1);
  // The second staff written over: the bars stay.
  M.write(mid.score, 1, 0, M.notated(2), A4);
  assert.deepEqual(lengths(read(engrave(mid.score).source)), [2, 2, 2, 2, 2]);
});

// ---- Two metres, bars as long ---------------------------------------------------------------

test("polymetre: 4/4 drawn beside 3/4, its notes scaled (\\scaleDurations, timeSignatureFraction) — read, edited, refused where lengths change", () => {
  const src = "<< \\new Staff { \\time 3/4 c'4 d' e' | f'2. } \\new Staff { \\set Staff.timeSignatureFraction = 4/4 \\scaleDurations 3/4 { c4 d e f | g1 } } >>";
  const { score, source } = roundTrip(src);
  assert.deepEqual(score.staves[1].shownTime, [4, 4]);
  assert.deepEqual(score.staves[1].events[0].scale, [3, 4]);
  assert.equal(M.ticksOf(score.staves[1].events[0]), (3 * q) / 4);
  assert.ok(M.isScaled(score, 1) && !M.isScaled(score, 0));
  assert.match(source, /\\time 3\/4 \\set Staff\.timeSignatureFraction = 4\/4\n {4}\\scaleDurations 3\/4 \{ c4 d4 e4 f4 \} \| \\scaleDurations 3\/4 \{ g1 \}/);
  // Pitches, articulations, transposing, a note made a rest: its length stays.
  M.setPitch(score, 1, 0, { d: 4, alter: 0 });
  M.toggleArticulation(score, 1, 1, "accent");
  M.remove(score, 1, 2);
  M.transpose(score, { steps: 1, semitones: 2 });
  let after = engrave(score).source;
  assert.match(after, /\\scaleDurations 3\/4 \{ a4 e4-> r4 g4 \} \| \\scaleDurations 3\/4 \{ a1 \}/);
  // A bar put in: a whole bar of rest at the staff's scale.
  M.insertBars(score, 1, 1);
  after = engrave(score).source;
  assert.match(after, /\| \\scaleDurations 3\/4 \{ r1 \} \|/);
  assert.match(after, /e'4 fis'4 \| r2\. \|/);
  M.deleteBars(score, 1, 1);
  // What would change a scaled note's length: refused, said, nothing changed.
  const was = M.toLilyPond(score).source;
  assert.throws(() => M.write(score, 1, 0, q, A4), /scaled \(\\scaleDurations/);
  assert.throws(() => M.setDuration(score, 1, 0, 2, 0), /scaled/);
  assert.throws(() => M.paste(score, 1, 0, M.copy(score, 0, 0, 0)), /scaled/);
  assert.throws(() => M.moveNote(score, 1, 0, { shift: q }), /scaled/);
  assert.throws(() => M.setTimeAt(score, 1, 2, 4), /change the metre or the pickup in the text/);
  assert.equal(M.toLilyPond(score).source, was);
  // The MIDI view moves its notes' pitch.
  M.moveNote(score, 1, 0, { semitones: 1 });
  assert.match(engrave(score).source, /\\scaleDurations 3\/4 \{ ais4/);
  // The other staff is written as any.
  M.write(score, 0, 0, q, A4);
  assert.match(engrave(score).source, /\\time 3\/4\n {4}a'4 e'4 fis'4/);
});

test("polymetre: \\enablePolymeter, 6/8 beside 3/4, each staff its own metre — kept", () => {
  const { score, source } = roundTrip("\\layout { \\enablePolymeter } << \\new Staff { \\time 3/4 c'4 d' e' | f'2. } \\new Staff { \\time 6/8 c8 d e f g a | b4. c' } >>");
  assert.deepEqual(score.staves[1].time, [6, 8]);
  assert.match(source, /^\\layout \{ \\enablePolymeter \}/);
  M.write(score, 1, 0, M.notated(8), A4);
  assert.match(engrave(score).source, /\\time 6\/8\n {4}a'8 d8 e8/);
});

// ---- Voices inside a voice -------------------------------------------------------------------

test("voices inside a voice: read as the staff's voices, the ones a passage leaves out drawn as nothing there", () => {
  const { score, source } = roundTrip("{ c'4 << { e'4 << { g'2 } \\\\ { e'2 } >> } \\\\ { c'2. } >> | d'1 }");
  assert.deepEqual(score.staves.map((lane) => lane.voice ?? 1), [1, 2, 3, 4]);
  assert.deepEqual(notes(score, 0).slice(0, 3), ["c'4", "e'4", "g'2"]);
  assert.deepEqual(notes(score, 3).slice(0, 3), ["r4", "s4", "e'2"]);
  // Voice 3, which no part of the source wrote, is nothing there.
  assert.deepEqual(notes(score, 2).slice(1), ["s2.", "r1"]);
  assert.match(source, /<< \{ c'4 e'4 g'2 \} \\\\ \{ r4 c'2\. \} \\\\ \{ r4 s2\. \} \\\\ \{ r4 s4 e'2 \} >> \| d'1/);
  // Each voice edited.
  M.write(score, 3, M.notated(2), M.notated(2), A4);
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(engrave(score).source, /\{ r4 s4 b'2 \} >> \| e'1/);
  const deep = roundTrip("\\new Staff { << { c''4 << { e''4 d'' } \\\\ { c''2 } >> b'4 } \\\\ { g'1 } >> | a'1 }");
  assert.deepEqual(notes(deep.score, 3).slice(0, 3), ["s4", "c''2", "s4"]);
});

// ---- Staves drawn smaller --------------------------------------------------------------------

test("staves drawn smaller (\\magnifyStaff, staff-space and fontSize in \\with): kept, and their notes found where they are drawn", () => {
  const src = "<< \\new Staff \\with { \\magnifyStaff #2/3 } { c'4 d'' e' f'' } \\new Staff { c'4 d'' e' f'' } \\new Staff \\with { \\override StaffSymbol.staff-space = #(magstep -3) fontSize = #-3 } { c'4 d'' e' f'' } >>";
  const { score, source } = roundTrip(src);
  assert.equal(score.staves[0].withMore, "\\magnifyStaff #2/3");
  assert.equal(score.staves[2].withMore, "\\override StaffSymbol.staff-space = #(magstep -3) fontSize = #-3");
  assert.match(source, /\\new Staff \\with \{ \\magnifyStaff #2\/3 \}/);
  M.write(score, 0, 0, q, A4);
  const { view } = engrave(score);
  const head = (item) => view.items.find((it) => it.item === item).heads[0].box;
  const width = (b) => b[2] - b[0];
  // A head of the small staff is two thirds of one of the plain staff, and lies inside its staff.
  assert.ok(Math.abs(width(head(0)) / width(head(4)) - 2 / 3) < 0.02, `${width(head(0))} ${width(head(4))}`);
  assert.ok(width(head(8)) < width(head(4)));
  const small = view.bars.filter((b) => b.bar === 0)[0];
  assert.ok(head(0)[1] >= small.box[1] - 20 && head(0)[3] <= view.items.find((it) => it.item === 4).heads[0].box[1], "the small staff's notes above the plain staff's");
  // Each note of each staff is its own item, in the order the model numbers them.
  assert.equal(view.items.length, 12);
});
