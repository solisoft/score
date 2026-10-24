// Practice (public/eui-score/practice.js, #391): the heard MIDI transposed
// and at another speed — through the studio's heardMidi chain, on the
// engraver's real MIDI — and the loop that goes faster each pass.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json, midi } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as Pr from "../../public/eui-score/practice.js";
import * as Ch from "../../public/eui-score/channels.js";
import * as Vel from "../../public/eui-score/velocity.js";
import * as A from "../../public/eui-score/automation.js";
import * as G from "../../public/eui-score/graces.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** The studio's heardMidi (studio.js), on node: engraver → channels → velocities → curves → graces → feel → practice. */
function heardMidi(score, { practice = null } = {}) {
  const passes = M.playback(score);
  const source = M.toLilyPond(score, { unfold: true }).source;
  const bytes = Ch.assignChannels(score, midi(source, M.DEFAULT_BPM, 4, 0));
  const curves = A.applyAutomation(score, Vel.applyVelocities(score, bytes), { passes });
  const felt = F.feel(G.applyGraces(score, curves, { passes }), { score, passes, ...F.feelOf(score.meta) });
  return practice ? Pr.applyPractice(felt, practice) : felt;
}

const read = (text) => {
  const { score } = M.fromParsed(JSON.parse(score_json(text)), text);
  score.meta = {};
  return score;
};

/** Each note-on as [channel, key, tick]. */
const noteOns = (bytes) =>
  F.readSmf(bytes)
    .tracks.flatMap((events) => events.filter((e) => (e.data[0] & 0xf0) === 0x90 && e.data[2] > 0).map((e) => [e.data[0] & 15, e.data[1], e.tick]))
    .sort((a, b) => a[2] - b[2] || a[1] - b[1]);
/** The tempo events, as microseconds a quarter. */
const tempos = (bytes) => F.readSmf(bytes).tracks.flatMap((events) => events.filter((e) => e.data[0] === 0xff && e.data[1] === 0x51).map((e) => Pr.tempoUs(e.data)));

const DUET = "<< \\new Staff { \\time 4/4 \\tempo 4 = 120 c''4 d'' e'' f'' | g''1 } \\new DrumStaff \\drummode { bd4 sn bd sn | bd1 } >>";

test("Play transposed: every pitched key moved, the drums and the timing kept", () => {
  const score = read(DUET);
  const plain = heardMidi(score);
  const up = heardMidi(score, { practice: { transpose: 3 } });
  const was = noteOns(plain);
  const now = noteOns(up);
  assert.equal(now.length, was.length);
  for (const [k, [channel, key, tick]] of was.entries()) {
    assert.equal(now[k][2], tick, "the same tick");
    assert.equal(now[k][1], channel === 9 ? key : key + 3, channel === 9 ? "a drum stays" : "a note three semitones up");
  }
  assert.ok(was.some(([channel]) => channel === 9), "the drums are there to stay put");
  // The tempo is not touched by a transposition.
  assert.deepEqual(tempos(up), tempos(plain));
  // Down an octave: the same notes twelve lower.
  assert.deepEqual(noteOns(heardMidi(score, { practice: { transpose: -12 } })).filter(([c]) => c !== 9).map(([, key]) => key), was.filter(([c]) => c !== 9).map(([, key]) => key - 12));
});

test("a transposition is kept to ±12, a key past the keyboard's end stays at the end, 0 changes nothing", () => {
  assert.equal(Pr.transposition(13), 12);
  assert.equal(Pr.transposition(-40), -12);
  assert.equal(Pr.transposition("2.6"), 3);
  assert.equal(Pr.transposition("x"), 0);
  assert.equal(Pr.transposeText(-1), "−1 semitone");
  assert.equal(Pr.transposeText(5), "+5 semitones");
  assert.equal(Pr.transposeText(0), "as written");
  const bytes = F.writeSmf({ format: 0, division: 480, tracks: [[{ tick: 0, data: [0x90, 125, 90] }, { tick: 480, data: [0x80, 125, 0] }, { tick: 480, data: [0xff, 0x2f, 0] }]] });
  assert.equal(Pr.transposeMidi(bytes, 0), bytes, "the same bytes");
  assert.deepEqual(noteOns(Pr.transposeMidi(bytes, 12)), [[0, 127, 0]]);
  const off = F.readSmf(Pr.transposeMidi(bytes, 12)).tracks[0][1].data;
  assert.deepEqual(off, [0x80, 127, 0], "its note-off moved alike");
});

test("a saved file's speed: each tempo event scaled, the notes on their ticks; 25 % to 200 %", () => {
  const score = read(DUET);
  const plain = heardMidi(score);
  const half = heardMidi(score, { practice: { tempo: 0.5 } });
  assert.deepEqual(noteOns(half), noteOns(plain), "the notes where they were, in ticks");
  // The engraver's 100 a quarter at the start, then the score's 120.
  assert.deepEqual(tempos(plain), [600000, 500000]);
  assert.deepEqual(tempos(half), [1200000, 1000000], "twice as long a quarter");
  assert.deepEqual(tempos(heardMidi(score, { practice: { tempo: 2 } })), [300000, 250000]);
  // Out of range: held at the ends.
  assert.deepEqual(tempos(heardMidi(score, { practice: { tempo: 10 } })), [300000, 250000]);
  assert.deepEqual(tempos(heardMidi(score, { practice: { tempo: 0.01 } })), [2400000, 2000000]);
  assert.equal(Pr.rateOf(undefined), 1);
  // Both at once, as Save the sound asks.
  const both = heardMidi(score, { practice: { tempo: 0.75, transpose: -2 } });
  assert.deepEqual(tempos(both), [800000, Math.round(500000 / 0.75)]);
  assert.equal(noteOns(both).find(([c]) => c !== 9)[1], noteOns(plain).find(([c]) => c !== 9)[1] - 2);
  // A file with no tempo event gets one, the MIDI default's, scaled.
  const bare = F.writeSmf({ format: 0, division: 480, tracks: [[{ tick: 0, data: [0x90, 60, 90] }, { tick: 480, data: [0x80, 60, 0] }, { tick: 480, data: [0xff, 0x2f, 0] }]] });
  assert.deepEqual(tempos(Pr.scaleTempo(bare, 0.5)), [1000000]);
  assert.equal(Pr.scaleTempo(bare, 1), bare);
});

test("a rit. glides as before, scaled: every tempo event of the glide", () => {
  const score = read("\\new Staff { \\time 4/4 \\tempo 4 = 100 c''4 d'' e'' f'' | g''1 }");
  const plain = tempos(heardMidi(score));
  const fast = tempos(heardMidi(score, { practice: { tempo: 1.25 } }));
  assert.equal(fast.length, plain.length);
  fast.forEach((us, k) => assert.ok(Math.abs(us - plain[k] / 1.25) <= 1));
});

test("the rising loop: from X, Y more each pass, stopping at Z — or looping there", () => {
  const ramp = { from: 60, step: 15, to: 100 };
  assert.deepEqual(Pr.rampPlan(ramp), [60, 75, 90, 100], "never past the target");
  assert.equal(Pr.rampPercent(ramp, 0), 60);
  assert.equal(Pr.rampPercent(ramp, 9), 100);
  // Pass after pass, until the target's pass is over.
  let pass = 0;
  const heard = [Pr.rampPercent(ramp, 0)];
  for (;;) {
    const next = Pr.rampAfter(ramp, pass);
    if (next.done) break;
    pass = next.pass;
    heard.push(next.percent);
  }
  assert.deepEqual(heard, [60, 75, 90, 100]);
  // Kept looping at the target instead.
  const on = { ...ramp, atTarget: "loop" };
  assert.deepEqual(Pr.rampAfter(on, 3), { percent: 100, pass: 4, done: false });
  assert.deepEqual(Pr.rampAfter(on, 40), { percent: 100, pass: 41, done: false });
  assert.equal(Pr.rampText(ramp, 1), "Pass 2 · 75 % (to 100 %)");
  assert.equal(Pr.rampText(ramp, 3), "Pass 4 · 100 % (the target, last pass)");
  assert.equal(Pr.rampText(on, 3), "Pass 4 · 100 % (the target, looping)");
});

test("a rising loop's settings are held in range: 25–200 %, the target never below the start", () => {
  assert.deepEqual(Pr.rampOf({}), { from: 70, step: 5, to: 100, atTarget: "stop" });
  assert.deepEqual(Pr.rampOf({ from: "10", step: "0", to: "500", atTarget: "forever" }), { from: 25, step: 1, to: 200, atTarget: "stop" });
  // A target below the start: the start is the target, one pass.
  assert.deepEqual(Pr.rampOf({ from: 120, to: 80 }), { from: 120, step: 5, to: 120, atTarget: "stop" });
  assert.deepEqual(Pr.rampPlan({ from: 120, to: 80 }), [120]);
  assert.equal(Pr.rampAfter({ from: 120, to: 80 }, 0).done, true);
  assert.deepEqual(Pr.rampOf(null), Pr.rampOf({}));
});
