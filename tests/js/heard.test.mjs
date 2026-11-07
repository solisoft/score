// What Play plays outside the editor (#682; public/eui-score/heard.js, for
// public/js/score.js): the read page, the shared and section pages and the
// examples play a score as the editor's Play does — each note at its own
// velocity, swung and humanized, its curves, its mixer's volume, pan, mute
// and solo — all read from the source's meta line.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as H from "../../public/eui-score/heard.js";
import * as F from "../../public/eui-score/feel.js";
import * as Vel from "../../public/eui-score/velocity.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const M = H.M;
const Q = M.WHOLE / 4;
/** What score.js hands heard.js: eui-score.js's toMidi and the engraver's reading, its spans in. */
const tools = {
  midi: async (source, { bpm = 100, beat = 4 } = {}) => midi(source, bpm, beat, 0),
  parse: (source) => {
    const parsed = JSON.parse(score_json(source));
    parsed.spans = JSON.parse(source_spans(source));
    return parsed;
  },
};
const meta = (obj) => `%% eui-score ${JSON.stringify(obj)}\n`;
/** Each note-on's key and velocity, in the order they sound. */
const ons = (bytes) => Vel.midiNoteOns(bytes).sort((a, b) => a.sec - b.sec || a.key - b.key);
const velocities = (bytes) => ons(bytes).map((n) => n.velocity);
/** Every controller change of a file: [channel, number, value]. */
const controls = (bytes) =>
  F.readSmf(bytes).tracks.flatMap((track) => track.filter((e) => (e.data[0] & 0xf0) === 0xb0).map((e) => [e.data[0] & 15, e.data[1], e.data[2]]));

const FOUR = "{ c'4 d' e' f' }\n";

test("each note at the velocity the score sets for it, the others at their dynamics", async () => {
  const plain = await H.heardMidi(FOUR, tools);
  assert.deepEqual(velocities(plain.bytes), [90, 90, 90, 90], "the dynamics alone");
  const set = await H.heardMidi(FOUR + meta({ velocity: { [`0:0:60`]: 20, [`0:${2 * Q}:64`]: 120 } }), tools);
  assert.deepEqual(velocities(set.bytes), [20, 90, 120, 90]);
  assert.equal(set.turns, 1);
});

test("the score is read with its meta line, and a meta line that is no object is nothing", () => {
  const score = H.scoreOf(FOUR + meta({ velocity: { "0:0:60": 20 } }), tools.parse);
  assert.deepEqual(score.meta, { velocity: { "0:0:60": 20 } });
  assert.deepEqual(H.scoreOf(`${FOUR}%% eui-score [20]\n`, tools.parse).meta, {});
  assert.deepEqual(H.scoreOf(`${FOUR}%% eui-score {broken\n`, tools.parse).meta, {});
});

test("swing and humanize from the meta line, on top of the velocities", async () => {
  const src = "{ c'8 d' e' f' g' a' b' c'' }\n";
  const straight = ons((await H.heardMidi(src, tools)).bytes).map((n) => n.sec);
  const swung = ons((await H.heardMidi(src + meta({ swing: { amount: 67, unit: 8 } }), tools)).bytes).map((n) => n.sec);
  assert.equal(swung[0], straight[0]);
  assert.ok(swung[1] > straight[1] + 0.03, `the off-beat eighth is late: ${swung[1]} vs ${straight[1]}`);
  const human = await H.heardMidi(src + meta({ humanize: { time: 0, velocity: 30, seed: 7 }, velocity: { "0:0:60": 40 } }), tools);
  const heard = velocities(human.bytes);
  assert.ok(heard.some((v) => v !== 90), `humanized: ${heard}`);
  assert.ok(Math.abs(heard[0] - 40) <= 13, `around the 40 set: ${heard[0]}`);
});

test("the mixer: a muted staff is left out, a solo leaves the others out, volume and pan in the file", async () => {
  const two = "<< \\new Staff { c'4 d' } \\new Staff { e'4 f' } >>\n";
  const both = ons((await H.heardMidi(two, tools)).bytes);
  assert.deepEqual(both.map((n) => n.key).sort(), [60, 62, 64, 65]);
  const muted = ons((await H.heardMidi(two + meta({ mixer: { tracks: { 1: { mute: true } } } }), tools)).bytes);
  assert.deepEqual(muted.map((n) => n.key), [60, 62], "the second staff muted");
  const solo = ons((await H.heardMidi(two + meta({ mixer: { tracks: { 1: { solo: true } } } }), tools)).bytes);
  assert.deepEqual(solo.map((n) => n.key), [64, 65], "the second staff alone");
  const level = await H.heardMidi(two + meta({ mixer: { tracks: { 0: { volume: -60 }, 1: { pan: -1 } } } }), tools);
  const cc = controls(level.bytes);
  assert.ok(cc.some(([, n, v]) => n === 7 && v === 0), `the first staff's fader at the bottom: ${JSON.stringify(cc)}`);
  assert.ok(cc.some(([, n, v]) => n === 10 && v === 0), "the second staff hard left");
});

test("the curves drawn are played", async () => {
  const bytes = (await H.heardMidi(FOUR + meta({ cc: { 0: { 1: [[0, 5], [2 * Q, 100]] } } }), tools)).bytes;
  const wheel = controls(bytes).filter(([, n]) => n === 1).map(([, , v]) => v);
  assert.ok(wheel.includes(5) && wheel.includes(100), `the modulation curve: ${wheel}`);
});

test("a section in a loop: played over and over, swung after the loop", async () => {
  const one = await H.heardMidi(FOUR, tools);
  const looped = await H.heardMidi(FOUR + meta({ velocity: { "0:0:60": 20 } }), { ...tools, loop: { bars: 1, time: "4/4" } });
  assert.equal(looped.turns, H.turnsOf(1));
  assert.equal(ons(looped.bytes).length, ons(one.bytes).length * looped.turns);
  assert.deepEqual(velocities(looped.bytes).slice(0, 8), [20, 90, 90, 90, 20, 90, 90, 90], "each turn at the velocities set");
});

test("a source the model does not read is played as written, its feel still heard", async () => {
  const unread = "\\version \"2.24\"\nmusic = { c'8 d' e' f' }\n{ \\music }\n";
  assert.equal(H.scoreOf(unread, () => { throw new Error("no"); }), null);
  const played = await H.heardMidi(FOUR, { ...tools, parse: () => { throw new Error("unread"); } });
  assert.deepEqual(velocities(played.bytes), [90, 90, 90, 90]);
});

test("withoutChannels: the notes of the silent channels out, the rest as it was", () => {
  const bytes = midi("<< \\new Staff { c'4 } \\new Staff { e'4 } >>\n", 100, 4, 0);
  assert.equal(H.withoutChannels(bytes, []), bytes, "nothing to leave out: the same bytes");
  const channels = Vel.midiNoteOns(bytes).map((n) => n.channel);
  const kept = Vel.midiNoteOns(H.withoutChannels(bytes, [channels[1]]));
  assert.deepEqual(kept.map((n) => n.key), [60]);
});
