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
  assert.deepEqual(R.rollHit(score, geo, middle(2), lane1), { bar: 2, lane: 1, note: null, ruler: false });
  assert.deepEqual(R.rollHit(score, geo, middle(2), 10), { bar: 2, lane: null, note: null, ruler: true }, "the ruler, where the loop is set");
  assert.equal(R.rollHit(score, geo, 10, lane1).bar, null, "the track names are no bar");
  assert.equal(R.rollHit(score, geo, middle(99), lane1).bar, 3, "past the end: the last bar");
  const target = { dataset: { lane: "0", index: "3", key: "65" } };
  assert.deepEqual(R.rollHit(score, geo, middle(0), 30, target).note, { lane: 0, index: 3, key: 65 });
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

test("one track alone on the keyboard: its notes, at its own range", () => {
  const score = read(PIANO);
  const bass = R.rollLayout(score, { layout: "keys", only: 1 });
  assert.ok(bass.notes.every((n) => n.lane === 1));
  assert.equal(bass.notes.length, 5);
  assert.ok(bass.tracks[0].high < 72, "not up to the treble's c''");
  assert.equal(bass.tracks[0].high - bass.tracks[0].low + 1, 25, "two octaves at least, to drag a note in");
  assert.ok(bass.tracks[0].low <= 43 && bass.tracks[0].high >= 48, "its notes inside");
  assert.equal(R.rollLayout(score, { layout: "tracks", only: 1 }).notes.length, R.rollNotes(score).length, "the tracks layout shows them all");
  const svg = R.drawRoll(score, { layout: "keys", only: 1 });
  assert.equal((svg.match(/data-lane="0"/g) ?? []).length, 0);
  assert.equal((svg.match(/data-lane="1"/g) ?? []).length, 5);
});

test("the loop is drawn on the ruler, apart from the selection", () => {
  const score = read(PIANO);
  const svg = R.drawRoll(score, { loop: [1, 2] });
  const geo = R.rollLayout(score);
  const loop = /<rect class="roll-loop" x="([\d.]+)" y="3" width="([\d.]+)"/.exec(svg);
  assert.ok(loop, "on the ruler");
  assert.equal(Number(loop[1]), geo.x(M.barStart(score, 1)) + 1);
  assert.equal(Number(loop[2]), geo.x(M.barStart(score, 3)) - geo.x(M.barStart(score, 1)) - 2);
  assert.match(svg, /class="roll-loop-span"/);
  assert.doesNotMatch(svg, /roll-band/, "no selection drawn for it");
  assert.doesNotMatch(R.drawRoll(score), /roll-loop/);
});

const engraves = (score) => assert.doesNotThrow(() => editor_view(M.toLilyPond(score).source, 900, 7, -1, -1));

/** Lane `s` as LilyPond, its bars only. */
const lane = (score, s = 0) => M.toLilyPond(score).source.split("\n").filter((line) => line.includes("|"))[s].trim();

test("a note dragged on the keyboard: later, higher, longer — the score follows", () => {
  const Q = M.WHOLE / 4;
  const score = read("{ \\time 4/4 c'4 d'4 e'4 f'4 | g'1 }");
  // d' a quarter later, over e': e' is written over, d' leaves a rest.
  const later = structuredClone(score);
  const i = M.moveNote(later, 0, 1, { shift: Q });
  assert.equal(M.starts(later.staves[0])[i], 2 * Q);
  assert.equal(lane(later), "c'4 r4 d'4 f'4 | g'1 \\bar \"|.\"");
  // Two semitones up, spelled in the key.
  const higher = structuredClone(score);
  M.moveNote(higher, 0, 0, { key: 60, semitones: 2 });
  assert.match(lane(higher), /^d'4 d'4 e'4 f'4/);
  // Longer, over the bar line: tied.
  const longer = structuredClone(score);
  M.moveNote(longer, 0, 3, { length: 2 * Q });
  assert.equal(lane(longer), "c'4 d'4 e'4 f'4~ | f'4 g'2. \\bar \"|.\"");
  // A tied note moves with its tie, shorter.
  const tied = structuredClone(longer);
  M.moveNote(tied, 0, 3, { length: Q / 2 });
  assert.match(lane(tied), /^c'4 d'4 e'4 f'8 r8 \| r4 g'2\./);
  engraves(later);
  engraves(longer);
});

test("one head of a chord moves alone up or down; the chord moves whole in time", () => {
  const score = read("{ \\time 4/4 <c' e' g'>2 r2 }");
  const one = structuredClone(score);
  M.moveNote(one, 0, 0, { key: 64, semitones: 1 });
  assert.match(lane(one), /^<c' f' g'>2/);
  const merged = structuredClone(score);
  M.moveNote(merged, 0, 0, { key: 64, semitones: 3 });
  assert.match(lane(merged), /^<c' g'>2/, "onto g': one head");
  const whole = structuredClone(score);
  M.moveNote(whole, 0, 0, { shift: M.WHOLE / 2 });
  assert.match(lane(whole), /^r2 <c' e' g'>2/);
});

test("on a drum staff a hit moves to the drum of its new key; the range and tuplets are refused", () => {
  const drums = read("\\new DrumStaff \\drummode { \\time 4/4 bd4 sn bd sn }");
  M.moveNote(drums, 0, 0, { key: 36, semitones: 6 });
  assert.equal(drums.staves[0].events[0].pitches[0].drum, "hh");
  assert.throws(() => M.moveNote(read("{ c'4 }"), 0, 0, { semitones: -60 }), /as far as it goes/);
  assert.throws(() => M.moveNote(read("{ c'4 }"), 0, 0, { shift: -M.WHOLE }), /as far as it goes/);
  assert.throws(() => M.moveNote(read("{ r4 c'4 }"), 0, 0, { shift: 1 }), /no note there/);
  assert.throws(() => M.moveNote(read("{ \\tuplet 3/2 { c'8 d' e' } f'4 }"), 0, 0, { shift: 1 }), /tuplet/);
});

// One staff of four voices above a bass.
const SATB = `\\new StaffGroup <<
  \\new Staff { << { e''2 f'' } \\\\ { c''2 d'' } \\\\ { g'2 a' } \\\\ { c'2 f' } >> | g''1 }
  \\new Staff { \\clef bass c1 | g,1 }
>>`;

test("each voice is a track of its own, named and coloured apart", () => {
  const score = read(SATB);
  assert.deepEqual(R.laneNames(score), ["Staff 1", "Staff 1, voice 2", "Staff 1, voice 3", "Staff 1, voice 4", "Staff 2"]);
  const colours = score.staves.map((_, s) => R.laneColour(score, s));
  assert.equal(new Set(colours).size, 5, "a colour per lane");
  assert.equal(R.rollLayout(score).tracks.length, 5);
  assert.deepEqual(R.rollNotes(score).filter((n) => n.lane === 2).map((n) => n.key), [67, 69], "voice 3's g' and a'");
  const svg = R.drawRoll(score);
  assert.match(svg, />Voice 4<title>Staff 1, voice 4<\/title>/);
  assert.match(svg, new RegExp(`data-lane="3" data-index="0" data-key="60"[^>]*fill="${colours[3]}"`));
});

test("a section of voices goes to the same voices, made on a staff that lacks them", () => {
  const score = read(SATB);
  const section = M.copySection(score, [0, 1, 2, 3, 4], 0, 0);
  assert.deepEqual(section.parts.map((p) => [p.offset, p.voice]), [[0, 1], [0, 2], [0, 3], [0, 4], [1, 1]]);
  // Onto the bass staff: voice 1 and its new voices 2 to 4; the bass part finds no staff below.
  const pasted = structuredClone(score);
  assert.equal(M.pasteSection(pasted, 4, 1, section), 1);
  assert.deepEqual(pasted.staves.map((l) => l.voice ?? 1), [1, 2, 3, 4, 1, 2, 3, 4]);
  assert.deepEqual(M.sectionLanes(pasted, 4, section), [4, 5, 6, 7]);
  for (let v = 0; v < 4; v++) assert.deepEqual(bar(pasted, 4 + v, 1), bar(score, v, 0), `voice ${v + 1}`);
  assert.doesNotThrow(() => editor_view(M.toLilyPond(pasted).source, 900, 7, -1, -1));
  // Voice 3 alone goes on the lane it is pasted on.
  const alone = structuredClone(score);
  assert.equal(M.pasteSection(alone, 4, 1, M.copySection(score, [2], 0, 0)), 0);
  assert.deepEqual(bar(alone, 4, 1), bar(score, 2, 0));
  assert.equal(alone.staves.length, 5);
  // Inserted as new bars, every voice grows with the staff.
  const inserted = structuredClone(score);
  M.insertSection(inserted, 0, 1, M.copySection(score, [0, 1, 2, 3], 0, 0));
  assert.ok(inserted.staves.every((l) => M.lengthOf(l) === M.lengthOf(inserted.staves[0])));
  assert.deepEqual(bar(inserted, 3, 1), bar(score, 3, 0));
  // A voice of rests the staff lacks is not made for nothing; voice 3 brings voice 2 with it.
  const rests = read("\\new StaffGroup << \\new Staff { << { e''1 } \\\\ { r1 } \\\\ { g'1 } >> } \\new Staff { c'1 } >>");
  const onto = structuredClone(rests);
  M.pasteSection(onto, 3, 0, M.copySection(rests, [0, 1, 2], 0, 0));
  assert.deepEqual(onto.staves.map((l) => l.voice ?? 1), [1, 2, 3, 1, 2, 3]);
  const onlyRests = structuredClone(rests);
  M.pasteSection(onlyRests, 3, 0, M.copySection(rests, [0, 1], 0, 0));
  assert.deepEqual(onlyRests.staves.map((l) => l.voice ?? 1), [1, 2, 3, 1], "voice 2 of rests not made");
});
