// A pickup bar (anacrusis, LilyPond's \partial): a short first bar the
// editor's model keeps, counts and writes back (#358).
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import { onsetSeconds } from "./midi_onsets.mjs";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);
const C4 = { rest: false, pitches: [{ d: 7, alter: 0 }] };
const D4 = { rest: false, pitches: [{ d: 8, alter: 0 }] };
const E4 = { rest: false, pitches: [{ d: 9, alter: 0 }] };

/** The score engraved; its LilyPond, or the engraver's refusal thrown. */
function engrave(score) {
  const { source, items } = M.toLilyPond(score);
  let view;
  try {
    view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  } catch (e) {
    throw new Error(`${e.message ?? e}\n${source}`);
  }
  assert.equal(view.items.length, items.length, `the engraver sees every item\n${source}`);
  return source;
}

const read = (src) => M.fromParsed(JSON.parse(score_json(src)));
const reread = (score) => read(M.toLilyPond(score).source).score;
const shape = (score) => score.staves.map((st) => st.events.map((e) => [e.rest ? "r" : e.pitches.map((p) => M.spellPitch(p.d, p.alter)).join("+"), M.ticksOf(e), e.tie]));

test("pickup: \\partial is read as a short first bar and written back as itself", () => {
  const result = read("{ \\time 3/4 \\partial 4 g'4 | c''2. | d''2 e''4 }");
  assert.equal(result.unsupported, undefined, "a pickup leaves the score tools on");
  const s = result.score;
  assert.equal(s.pickup, q);
  const source = engrave(s);
  assert.match(source, /\\time 3\/4 \\partial 4\n/);
  assert.match(source, /g'4 \| c''2\. \| d''2 e''4/);
  const back = reread(s);
  assert.equal(back.pickup, q);
  assert.deepEqual(shape(back), shape(s));
  // Every staff writes it: the engraver counts each staff's bars.
  const piano = read("\\new PianoStaff << \\new Staff { \\partial 8 g'8 c''1 } \\new Staff { \\clef bass \\partial 8 r8 c1 } >>").score;
  assert.equal(M.toLilyPond(piano).source.match(/\\partial 8\n/g).length, 2);
  engrave(piano);
});

test("pickup: what the model cannot follow still leaves the piece to its text", () => {
  // A \\partial after the first note makes its bar that much longer (#408): read.
  const later = read("{ c'4 \\partial 4 d'4 }").score;
  assert.equal(M.barLength(later, 0), 2 * q);
  assert.deepEqual(read("<< \\new Staff { \\partial 4 c'4 d'1 } \\new Staff { \\partial 8 c'8 d'1 } >>").unsupported, ["staves whose pickups differ"]);
  // The same pickup on every staff is the score's.
  assert.equal(read("<< \\new Staff { \\partial 4 c'4 d'1 } \\new Staff { \\partial 4 c'4 d'1 } >>").score.pickup, q);
});

test("pickup: bars, bar lines and bar numbers count the short first bar", () => {
  const s = M.fromTemplate("blank", { time: [3, 4], bars: 4, pickup: q });
  assert.equal(M.barsOf(s), 5, "the pickup and four full bars");
  assert.equal(M.barLength(s, 0), q);
  assert.equal(M.barLength(s, 1), 3 * q);
  assert.equal(M.barStart(s, 1), q);
  assert.equal(M.barStart(s, 2), 4 * q);
  assert.equal(M.barAt(s, 0), 0);
  assert.equal(M.barAt(s, q - 1), 0);
  assert.equal(M.barAt(s, q), 1);
  assert.equal(M.barAt(s, 4 * q), 2);
  assert.ok(M.isBarLine(s, q) && !M.isBarLine(s, 2 * q));
  assert.equal(M.nextBarLine(s, 0), q);
  // The pickup is bar 0, as LilyPond and the engraver number it.
  assert.deepEqual([0, 1, 4].map((b) => M.barNumber(s, b)), [0, 1, 4]);
  assert.deepEqual([0, 1].map((b) => M.barNumber(M.newScore(), b)), [1, 2]);
  assert.equal(M.lengthOf(s.staves[0]), 13 * q);
  engrave(s);
  // Refused: a pickup as long as a bar.
  assert.throws(() => M.fromTemplate("blank", { time: [3, 4], pickup: 3 * q }), /shorter than a bar of 3\/4/);
});

test("pickup: notes are written in it and after it, one longer than the pickup tied over its bar line", () => {
  const s = M.fromTemplate("blank", { time: [4, 4], bars: 2, pickup: q });
  M.write(s, 0, q, q, D4);
  // A half note from the pickup's start: a quarter in it, tied to a quarter after it.
  M.write(s, 0, 0, 2 * q, E4);
  assert.deepEqual(shape(s)[0].slice(0, 3), [["e'", q, true], ["e'", q, false], ["r", M.notated(2, 1), false]]);
  assert.match(engrave(s), /\\partial 4\n {2}e'4~ \| e'4 r2\. \|/);
  // A letter edits the note in the pickup, in place; one after it is untouched.
  M.write(s, 0, 0, q, C4);
  M.letter(s, 0, 0, 2);
  assert.equal(M.spellPitch(s.staves[0].events[0].pitches[0].d, 0), "e'");
  M.letter(s, 0, 1, 3);
  assert.deepEqual(shape(s)[0].slice(0, 2), [["e'", q, false], ["f'", q, false]]);
  assert.deepEqual(shape(reread(s)), shape(s));
});

test("pickup: played, its beats are the bar's last; the bars after it start on their downbeat", () => {
  const s = M.fromTemplate("blank", { time: [3, 4], bars: 1, bpm: 60, pickup: q });
  M.write(s, 0, q, q, C4);
  const passes = M.playback(s);
  assert.deepEqual(passes.map((p) => [p.bar, p.start, p.end]), [[0, 0, 1], [1, 1, 4]]);
  assert.deepEqual(M.beats(s, passes).map((b) => [b.sec, b.down]), [[0, false], [1, true], [2, false], [3, false]]);
  assert.deepEqual(M.playedAt(s, passes, q), [1]);
  assert.equal(M.tickAtPlayed(s, passes, 0.5), q / 2);
  const heard = onsetSeconds(midi(M.toLilyPond(s, { unfold: true }).source, 100, 4, 0));
  assert.deepEqual(heard.map((h) => +h.toFixed(3)), [1], "the note after the pickup sounds a beat in");
});

test("pickup: a repeat from the first full bar is engraved and played out", () => {
  const s = M.fromTemplate("blank", { time: [4, 4], bars: 2, pickup: q });
  M.toggleRepeat(s, 1, 2);
  assert.match(engrave(s), /\\partial 4\n {2}r4 \| \\repeat volta 2 \{/);
  assert.deepEqual(M.playOrder(s), [0, 1, 2, 1, 2]);
  assert.ok(midi(M.toLilyPond(s, { unfold: true }).source, 100, 4, 0).length > 0);
});

test("pickup: set, changed and taken away in an existing score, the bars after it kept", () => {
  const s = M.fromTemplate("blank", { time: [4, 4], bars: 2 });
  M.write(s, 0, 3 * q, q, C4);
  M.write(s, 0, 4 * q, q, D4);
  // A quarter pickup: the first bar's last beat, the note on it kept.
  M.setPickup(s, q);
  assert.equal(s.pickup, q);
  assert.deepEqual(shape(s)[0].slice(0, 2), [["c'", q, false], ["d'", q, false]]);
  assert.equal(M.barsOf(s), 2, "the pickup, then the second bar as it was");
  engrave(s);
  // Longer: rests before it.
  M.setPickup(s, 2 * q);
  assert.deepEqual(shape(s)[0].slice(0, 2), [["r", q, false], ["c'", q, false]]);
  // None: a full bar again, rests before the music.
  M.setPickup(s, 0);
  assert.equal(s.pickup, undefined);
  assert.deepEqual(shape(s)[0].slice(0, 2), [["r", M.notated(2, 1), false], ["c'", q, false]]);
  assert.doesNotMatch(engrave(s), /\\partial/);
  // Refused: notes a shorter pickup would lose, a pickup as long as a bar, an odd length — the score left as it was.
  M.setPickup(s, 2 * q);
  M.write(s, 0, 0, q, E4);
  const before = JSON.stringify(s);
  assert.throws(() => M.setPickup(s, q), /would lose them/);
  assert.throws(() => M.setPickup(s, 4 * q), /shorter than a bar/);
  assert.throws(() => M.setPickup(s, 7), /128ths/);
  assert.equal(JSON.stringify(s), before);
});

test("pickup: its value as the menus write it", () => {
  assert.equal(M.pickupOf(""), 0);
  assert.equal(M.pickupOf("4."), M.notated(4, 1));
  assert.equal(M.pickupOf("8*3"), 3 * M.notated(8));
  assert.throws(() => M.pickupOf("3"), /a duration/);
  assert.equal(M.pickupText(q), "4");
  assert.equal(M.pickupText(M.notated(2, 1)), "2.");
  assert.equal(M.pickupText(5 * M.notated(8)), "8*5");
  assert.throws(() => M.pickupText(7), /128ths/);
});

test("pickup: the metre changed, bars put in and taken away around it", () => {
  const s = M.fromTemplate("blank", { time: [4, 4], bars: 2, pickup: q });
  M.write(s, 0, 0, q, C4);
  M.setKeyAt(s, 1, 2);
  M.setTime(s, 3, 4);
  assert.equal(s.pickup, q);
  assert.equal(M.barLength(s, 1), 3 * q);
  assert.deepEqual(shape(s)[0][0], ["c'", q, false]);
  assert.equal(M.changeAt(s, 1)?.key, 2, "the change of key kept on the first full bar");
  engrave(s);
  assert.throws(() => M.setTime(s, 1, 4), /pickup is not shorter/);
  assert.throws(() => M.insertBars(s, 0, 1), /bars go after it/);
  M.insertBars(s, 1, 1);
  assert.equal(M.barStart(s, 2), 4 * q);
  engrave(s);
  // The pickup taken away with its bar: the piece starts on a full bar.
  M.deleteBars(s, 0, 0);
  assert.equal(s.pickup, undefined);
  assert.equal(M.barLength(s, 0), 3 * q);
  engrave(s);
});
