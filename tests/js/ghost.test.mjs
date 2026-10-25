// Note input's ghost note (#398): the staff position under the pointer read
// as a pitch through the clef, the ledger lines, and the time a click writes.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view_lit } from "../../public/eui-score/eui_score_web.js";
import * as Gh from "../../public/eui-score/ghost.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const name = (clef, step, fifths = 0) => Gh.nameOf(Gh.pitchAt(clef, step, fifths));

test("ghost: a staff position is a step above the bottom line, half a space each", () => {
  // A staff whose top line is at 10, a space of 8: its bottom line at 42.
  assert.equal(Gh.stepAt(42, 10, 8), 0);
  assert.equal(Gh.stepAt(10, 10, 8), 8);
  assert.equal(Gh.stepAt(26, 10, 8), 4);
  assert.equal(Gh.stepAt(38, 10, 8), 1, "the first space");
  assert.equal(Gh.stepAt(40.5, 10, 8), 0, "nearer the line than the space");
  assert.equal(Gh.stepAt(50, 10, 8), -2, "the first ledger line below");
  assert.equal(Gh.stepAt(-6, 10, 8), 12, "two ledger lines above");
  for (let step = -6; step <= 14; step++) assert.equal(Gh.stepAt(Gh.yOfStep(step, 10, 8), 10, 8), step);
});

test("ghost: treble, bass, alto, tenor and the octave clefs read their lines", () => {
  assert.deepEqual([0, 4, 8, -2, 10].map((s) => name("treble", s)), ["E4", "B4", "F5", "C4", "A5"]);
  assert.deepEqual([0, 4, 8, 10].map((s) => name("bass", s)), ["G2", "D3", "A3", "C4"]);
  assert.deepEqual([0, 4, 8].map((s) => name("alto", s)), ["F3", "C4", "G4"]);
  assert.deepEqual([0, 4].map((s) => name("tenor", s)), ["D3", "A3"]);
  assert.equal(name("soprano", 0), "C4");
  assert.equal(name("treble_8", 0), "E3");
  assert.equal(name("treble^8", 0), "E5");
  assert.equal(name("bass_8", 0), "G1");
  assert.equal(name("bass^8", 0), "G3");
  assert.equal(name("unknown", 0), "E4", "an unknown clef reads as treble");
});

test("ghost: the key signature's accidental goes with the step", () => {
  // G major: F sharp. F major: B flat. E flat major: B, E, A.
  assert.equal(name("treble", 8, 1), "F♯5");
  assert.equal(name("treble", 1, 1), "F♯4");
  assert.equal(name("treble", 4, 1), "B4");
  assert.equal(name("treble", 4, -1), "B♭4");
  assert.equal(name("treble", 0, -1), "E4");
  assert.deepEqual([4, 0, 3].map((s) => name("treble", s, -3)), ["B♭4", "E♭4", "A♭4"]);
  assert.equal(name("treble", 2, -3), "G4");
  // Seven sharps and seven flats: every step.
  for (let s = 0; s < 7; s++) {
    assert.equal(Gh.pitchAt("treble", s, 7).alter, 1);
    assert.equal(Gh.pitchAt("treble", s, -7).alter, -1);
  }
  // As score-model.js spells the key.
  for (let fifths = -7; fifths <= 7; fifths++) assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((d) => Gh.keyAlter(d, fifths)), M.keyAlters(fifths));
});

test("ghost: the MIDI key of the pitch, as score-model.js has it", () => {
  for (const p of [{ d: 7, alter: 0 }, { d: 13, alter: -1 }, { d: -3, alter: 1 }, { d: 21, alter: 0 }]) assert.equal(Gh.midiOf(p), M.midiKey(p.d, p.alter));
  assert.equal(Gh.midiOf(Gh.pitchAt("treble", -2)), 60);
  assert.equal(Gh.reachable({ d: -7, alter: 0 }), true);
  assert.equal(Gh.reachable({ d: -8, alter: 0 }), false);
  assert.equal(Gh.reachable({ d: 35, alter: 0 }), true, "C8");
  assert.equal(Gh.reachable({ d: 35, alter: 1 }), false, "past C8");
});

test("ghost: ledger lines from the staff to the head, none on the staff", () => {
  for (let step = -1; step <= 9; step++) assert.deepEqual(Gh.ledgers(step), []);
  assert.deepEqual(Gh.ledgers(-2), [-2]);
  assert.deepEqual(Gh.ledgers(-3), [-2]);
  assert.deepEqual(Gh.ledgers(-6), [-2, -4, -6]);
  assert.deepEqual(Gh.ledgers(10), [10]);
  assert.deepEqual(Gh.ledgers(13), [10, 12]);
});

test("ghost: a drum staff's positions are its drums; between them, none", () => {
  assert.equal(Gh.drumAt(Gh.pitchAt("percussion", 1).d, M.DRUMS), "bd");
  assert.equal(Gh.drumAt(Gh.pitchAt("percussion", 5).d, M.DRUMS), "sn");
  assert.equal(Gh.drumAt(Gh.pitchAt("percussion", 7).d, M.DRUMS), "hh");
  assert.equal(Gh.drumAt(Gh.pitchAt("percussion", -4).d, M.DRUMS), null);
  assert.equal(Gh.drumAt(Gh.pitchAt("percussion", 12).d, M.DRUMS), null);
});

test("ghost: each clef's lines are where the engraver draws the heads", () => {
  const cases = [
    ["treble", "e'4 b'4 f''4 c'4", [0, 4, 8, -2]],
    ["bass", "g,4 d4 a4 c'4", [0, 4, 8, 10]],
    ["alto", "f4 c'4 g'4 c''4", [0, 4, 8, 11]],
  ];
  for (const [clef, notes, steps] of cases) {
    const view = JSON.parse(editor_view_lit(`\\version "2.24.0"\n\\new Staff { \\clef ${clef} \\time 4/4 ${notes} }`, 600, 8, "{}"));
    const top = view.bars[0].staves[0];
    view.items.forEach((it, k) => {
      const [, y0, , y1] = it.heads[0].box;
      assert.equal(Gh.stepAt((y0 + y1) / 2, top, 8), steps[k], `${clef}, note ${k + 1}`);
    });
  }
  // The drums, where score-model.js says they are drawn.
  const drums = JSON.parse(editor_view_lit(`\\version "2.24.0"\n\\new DrumStaff \\drummode { \\time 4/4 bd4 sn4 hh4 cymc4 }`, 600, 8, "{}"));
  const top = drums.bars[0].staves[0];
  ["bd", "sn", "hh", "cymc"].forEach((drum, k) => {
    const [, y0, , y1] = drums.items[k].heads[0].box;
    assert.equal(Gh.pitchAt("percussion", Gh.stepAt((y0 + y1) / 2, top, 8)).d, M.drumPitch(drum).d, drum);
  });
});

test("ghost: the time snaps to the event under the pointer, and along a long rest to the duration", () => {
  const Q = M.WHOLE / 4;
  // A bar of 4/4 from x 0 to 400: a quarter note at 0, a quarter rest at 100, a half rest at 200.
  const spans = [
    { t: 0, ticks: Q, x: 0, rest: false, tuplet: false },
    { t: Q, ticks: Q, x: 100, rest: true, tuplet: false },
    { t: 2 * Q, ticks: 2 * Q, x: 200, rest: true, tuplet: false },
  ];
  assert.equal(Gh.snapTime(spans, -20, 400, 0, Q), 0, "left of the first event: the first");
  assert.equal(Gh.snapTime(spans, 60, 400, 0, Q), 0, "over the note: its start");
  assert.equal(Gh.snapTime(spans, 150, 400, 0, Q), Q, "a rest no longer than the duration: its start");
  assert.equal(Gh.snapTime(spans, 250, 400, 0, Q), 2 * Q, "the half rest's first beat");
  assert.equal(Gh.snapTime(spans, 330, 400, 0, Q), 3 * Q, "its second beat");
  assert.equal(Gh.snapTime(spans, 900, 400, 0, Q), 3 * Q, "past the bar: the last place in it");
  assert.equal(Gh.snapTime(spans, 330, 400, 0, 2 * Q), 2 * Q, "a half: only the rest's start");
  assert.equal(Gh.snapTime(spans, 390, 400, 0, Q / 2), 3 * Q + Q / 2, "an eighth: to the eighths");
  // A rest that starts off the beat: its start, then the beats from the bar line.
  const off = [
    { t: 0, ticks: Q / 2, x: 0, rest: false, tuplet: false },
    { t: Q / 2, ticks: 3.5 * Q, x: 50, rest: true, tuplet: false },
  ];
  assert.equal(Gh.snapTime(off, 60, 400, 0, Q), Q / 2);
  assert.equal(Gh.snapTime(off, 160, 400, 0, Q), Q);
  // A tuplet's slot: its start, never inside it.
  const tuplet = [{ t: 0, ticks: Q, x: 0, rest: true, tuplet: true }];
  assert.equal(Gh.snapTime(tuplet, 300, 400, 0, Q / 4), 0);
  // The bar's origin counts: a second bar.
  const second = [{ t: M.WHOLE, ticks: M.WHOLE, x: 0, rest: true, tuplet: false }];
  assert.equal(Gh.snapTime(second, 210, 400, M.WHOLE, Q), M.WHOLE + 2 * Q);
  assert.equal(Gh.snapTime([], 10, 400, 0, Q), null, "no events: nowhere");
  // Just left of an event's head, with a lead: that event; the lead does not push along a rest.
  assert.equal(Gh.snapTime(spans, 95, 400, 0, Q), 0);
  assert.equal(Gh.snapTime(spans, 95, 400, 0, Q, 8), Q);
  assert.equal(Gh.snapTime(spans, 296, 400, 0, Q, 8), 2 * Q, "the lead is not added along the half rest");
});

test("ghost: its picture has the duration's head, stem and flags, the ledger lines and the key's accidental", () => {
  const svg = (o) => Gh.ghostSvg({ sp: 10, ...o });
  assert.equal(Gh.flagsOf(4), 0);
  assert.equal(Gh.flagsOf(8), 1);
  assert.equal(Gh.flagsOf(32), 3);
  const whole = svg({ step: 4, base: 1 });
  assert.match(whole, /<ellipse[^>]*fill="none"/, "a whole: hollow");
  assert.doesNotMatch(whole, /<line/, "and no stem");
  const quarter = svg({ step: 4, base: 4 });
  assert.match(quarter, /<ellipse[^>]*stroke="none"/, "a quarter: filled");
  assert.equal((quarter.match(/<line/g) ?? []).length, 1, "its stem");
  assert.equal((svg({ step: 4, base: 16 }).match(/<path/g) ?? []).length, 2, "a sixteenth: two flags");
  assert.equal((svg({ step: -4, base: 1 }).match(/<line/g) ?? []).length, 2, "two ledger lines below");
  assert.match(svg({ step: 1, base: 4, alter: 1 }), /♯/);
  assert.match(svg({ step: 4, base: 4, alter: -1 }), /♭/);
  assert.doesNotMatch(svg({ step: 4, base: 4 }), /<text/, "no accidental where the key has none");
  assert.equal((svg({ step: 4, base: 4, dots: 2 }).match(/<circle/g) ?? []).length, 2);
  // A head below the middle line: stem up, to its right; above: down, to its left.
  assert.match(svg({ step: 2, base: 4 }), /<line x1="5.6" y1="0" x2="5.6" y2="-34"/);
  assert.match(svg({ step: 6, base: 4 }), /<line x1="-5.6" y1="0" x2="-5.6" y2="34"/);
  assert.match(Gh.PEN_SVG, /^<svg/);
});
