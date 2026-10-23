// The MIDI view (public/eui-score/piano-roll.js) and the sections it copies
// (copySection, pasteSection, insertSection in score-model.js), on scores
// read by the real engraver.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json, editor_view } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as R from "../../public/eui-score/piano-roll.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;

// Two staves, four bars: a tie across bar 2, a chord, a rest.
const PIANO = `\\score { \\new PianoStaff <<
  \\new Staff { \\clef treble \\time 4/4 c'4 d' e' f' | g'1 ~ | g'2 <c' e'>2 | r4 a' b' c'' }
  \\new Staff { \\clef bass \\time 4/4 c1 | g,1 | c2 g, | c1 }
>> }`;

/** The pitches of lane `s` in bar `bar`, as MIDI keys per event (rests as null). */
function bar(score, s, b) {
  const staff = score.staves[s];
  const at = M.starts(staff);
  const [t0, t1] = [M.barStart(score, b), M.barStart(score, b + 1)];
  return staff.events.filter((_, i) => at[i] >= t0 && at[i] < t1).map((ev) => (ev.rest ? null : ev.pitches.map((p) => M.midiKey(p.d, p.alter))));
}

test("the roll's notes: ties joined, a chord a note per pitch, rests left out", () => {
  const score = read(PIANO);
  const notes = R.rollNotes(score).filter((n) => n.lane === 0);
  assert.deepEqual(notes.map((n) => n.key), [60, 62, 64, 65, 67, 60, 64, 69, 71, 72]);
  const tied = notes.find((n) => n.key === 67);
  assert.equal(tied.t0, M.barStart(score, 1));
  assert.equal(tied.t1, M.barStart(score, 2) + M.WHOLE / 2, "the g' held over the bar line is one note");
  assert.equal(tied.last, tied.index + 1);
  const chord = notes.filter((n) => n.t0 === M.barStart(score, 2) + M.WHOLE / 2);
  assert.deepEqual(chord.map((n) => n.key), [60, 64]);
  assert.equal(R.rollNotes(score).filter((n) => n.lane === 1).length, 5);
});

test("drums sound as their General MIDI keys", () => {
  const score = read("\\new DrumStaff \\drummode { bd4 sn hh sn }");
  assert.deepEqual(R.rollNotes(score).map((n) => n.key), [36, 38, 42, 38]);
});

test("the tracks layout gives each lane its strip, the keys layout one keyboard", () => {
  const score = read(PIANO);
  const tracks = R.rollLayout(score);
  assert.equal(tracks.tracks.length, 2);
  assert.ok(tracks.tracks[1].y >= tracks.tracks[0].y + tracks.tracks[0].h, "strips do not overlap");
  assert.ok(tracks.tracks.every((t) => t.h >= 34 && t.h <= 96));
  const keys = R.rollLayout(score, { layout: "keys" });
  assert.equal(keys.tracks.length, 1);
  assert.equal(keys.tracks[0].low, 43 - 2, "from the lowest note, g, (43), less two");
  assert.equal(keys.tracks[0].high, 72 + 2);
  assert.ok(keys.height > tracks.height, "the keyboard is the taller");
  assert.ok(R.rollLayout(score, { zoom: 2 }).width > tracks.width, "zoom widens");
});

test("a point of the roll names its bar, its track and its note", () => {
  const score = read(PIANO);
  const geo = R.rollLayout(score);
  const middle = (b) => geo.x(M.barStart(score, b)) + 5;
  const lane1 = geo.tracks[1].y + 5;
  assert.deepEqual(R.rollHit(score, geo, middle(2), lane1), { bar: 2, lane: 1, note: null });
  assert.equal(R.rollHit(score, geo, 10, lane1).bar, null, "the track names are no bar");
  assert.equal(R.rollHit(score, geo, middle(99), lane1).bar, 3, "past the end: the last bar");
  const target = { dataset: { lane: "0", index: "3" } };
  assert.deepEqual(R.rollHit(score, geo, middle(0), 30, target).note, { lane: 0, index: 3 });
  assert.equal(R.rollHit(score, R.rollLayout(score, { layout: "keys" }), middle(1), 40).lane, null, "the keyboard has no tracks");
});

test("the drawing: bars numbered, tracks named, the section and the notes being played marked", () => {
  const score = read(PIANO);
  score.staves[0].name = "Right hand";
  const sel = { staff: 0, t0: 0, t1: 0, bars: [1, 2], lanes: [0, 1] };
  const svg = R.drawRoll(score, { sel, lit: new Set(["1:0"]), cursor: 0 });
  assert.match(svg, /^<svg [^>]*class="roll roll-tracks"/);
  assert.equal((svg.match(/class="roll-bar-number"/g) ?? []).length, 4);
  assert.match(svg, />Right hand</);
  assert.equal((svg.match(/class="roll-band"/g) ?? []).length, 1);
  assert.match(svg, /class="roll-note roll-note-lit" data-lane="1" data-index="0"/);
  assert.match(svg, /class="roll-cursor"/);
  // In bars 2–3: the tied g' (from bar 2), the chord, and the bass's three.
  assert.equal((svg.match(/roll-note-chosen/g) ?? []).length, 1 + 2 + 3);
  const keys = R.drawRoll(score, { layout: "keys" });
  assert.match(keys, /class="roll roll-keys"/);
  assert.match(keys, />C4</);
  assert.equal(R.keyName(61), "C♯4");
});

test("a section of bars and staves is copied, pasted over bars, and inserted as new bars", () => {
  const score = read(PIANO);
  const before = { top: bar(score, 0, 3), bass: bar(score, 1, 3) };
  const section = M.copySection(score, [0, 1], 0, 1);
  assert.equal(section.bars, 2);
  assert.deepEqual(section.parts.map((p) => p.offset), [0, 1]);
  assert.equal(section.parts[0].pieces.length, 5, "c' d' e' f' and the tied g'");
  assert.match(M.sectionText(section), /^<< \\new Staff \{ c'4 d'4 e'4 f'4 g'1~ \} \\new Staff \{ c1 g,1 \} >>$/);

  // Over bars 3–4: what was there is replaced, the score as long as before.
  const pasted = structuredClone(score);
  assert.equal(M.pasteSection(pasted, 0, 2, section), 0);
  assert.equal(M.barsOf(pasted), 4);
  assert.deepEqual(bar(pasted, 0, 2), bar(score, 0, 0));
  assert.deepEqual(bar(pasted, 1, 3), bar(score, 1, 1));

  // Before bar 3: two new bars, and what followed moves along intact.
  const inserted = structuredClone(score);
  assert.equal(M.insertSection(inserted, 0, 2, section), 0);
  assert.equal(M.barsOf(inserted), 6);
  assert.deepEqual(bar(inserted, 0, 2), bar(score, 0, 0));
  assert.deepEqual(bar(inserted, 1, 3), bar(score, 1, 1));
  assert.deepEqual(bar(inserted, 0, 5), before.top);
  assert.deepEqual(bar(inserted, 1, 5), before.bass);
  // Every lane as long as the others, and the engraver takes it.
  assert.equal(M.lengthOf(inserted.staves[0]), M.lengthOf(inserted.staves[1]));
  assert.doesNotThrow(() => editor_view(M.toLilyPond(inserted).source, 900, 7, -1, -1));
});

test("a section keeps its staves' order, skips staves the score lacks, refuses tuplets and no staff", () => {
  const score = read(PIANO);
  const bassOnly = M.copySection(score, [1], 0, 0);
  assert.equal(bassOnly.parts.length, 1);
  assert.equal(bassOnly.parts[0].offset, 0);
  assert.equal(M.sectionText(bassOnly), "\\new Staff { c1 }");
  // Both staves pasted from the bass: the second finds no lane.
  const copy = structuredClone(score);
  assert.equal(M.pasteSection(copy, 1, 3, M.copySection(score, [0, 1], 0, 0)), 1);
  assert.deepEqual(bar(copy, 1, 3), bar(score, 0, 0));
  assert.throws(() => M.copySection(score, [], 0, 1), /choose a staff/);
  const tuplets = read("{ \\tuplet 3/2 { c'8 d' e' } f'4 g'2 }");
  assert.throws(() => M.copySection(tuplets, [0], 0, 0), /tuplets/);
});
