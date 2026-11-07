// Each note's velocity (public/eui-score/velocity.js): kept in the score's
// text, carried along by the edits that move a note, and written into the
// MIDI the real engraver makes — on every pass of a repeat.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as R from "../../public/eui-score/piano-roll.js";
import * as V from "../../public/eui-score/velocity.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => {
  const score = M.fromParsed(JSON.parse(score_json(source))).score;
  score.meta = M.readMeta(source);
  return score;
};
const Q = M.WHOLE / 4;
/** The MIDI as Play writes it: every repeat played out. */
const played = (score) => midi(M.toLilyPond(score, { unfold: true }).source, M.DEFAULT_BPM, 4, 0);
/** Each note-on's key and velocity, in the order they sound. */
const ons = (bytes) => V.midiNoteOns(bytes).sort((a, b) => a.sec - b.sec || a.key - b.key).map((n) => [n.key, n.velocity]);

test("the meta line: read, merged key by key, kept last, and gone when empty", () => {
  const src = "{ c'4 }\n";
  assert.deepEqual(M.readMeta(src), {});
  const one = M.writeMeta(src, { mixer: { a: 1 } });
  assert.equal(one, '{ c\'4 }\n%% eui-score {"mixer":{"a":1}}\n');
  const two = M.writeMeta(one, { velocity: { "0:0:60": 90 } });
  assert.deepEqual(M.readMeta(two), { mixer: { a: 1 }, velocity: { "0:0:60": 90 } }, "another feature's key is kept");
  assert.equal(two.match(/%% eui-score/g).length, 1, "one line");
  assert.ok(two.endsWith("}\n") && two.split("\n").at(-2).startsWith("%% eui-score"), "the last line");
  assert.equal(M.writeMeta(two, { mixer: null, velocity: null }), src, "nothing left: no line");
  assert.deepEqual(M.readMeta("{ c'4 }\n%% eui-score {broken"), {}, "a line that does not read is nothing");
  assert.deepEqual(M.readMeta("%% eui-score [1,2]"), {}, "only an object");
});

test("the score keeps its meta through a rewrite, and the engraver passes over it", () => {
  const score = read("{ c'4 d' e' f' }\n%% eui-score {\"velocity\":{\"0:0:60\":30},\"other\":true}\n");
  M.write(score, 0, Q, Q, { rest: false, pitches: [{ d: 9, alter: 0 }] });
  const { source } = M.toLilyPond(score);
  assert.deepEqual(M.readMeta(source), { velocity: { "0:0:60": 30 }, other: true });
  assert.ok(!M.toLilyPond(score, { unfold: true }).source.includes("eui-score"), "not in what is played");
  assert.doesNotThrow(() => midi(source, 100, 4, 0));
  assert.deepEqual(JSON.parse(score_json(source)).warnings, []);
});

test("velocities set go into the MIDI; the others play as their dynamics", () => {
  const score = read("{ c'4\\p d' e' f' }");
  const before = ons(played(score));
  assert.deepEqual(before.map(([, v]) => v), [64, 64, 64, 64]);
  V.setVelocities(score, { [V.noteId(0, Q, 62)]: 120, [V.noteId(0, 3 * Q, 65)]: 5 });
  const after = ons(V.applyVelocities(score, played(score)));
  assert.deepEqual(after, [[60, 64], [62, 120], [64, 64], [65, 5]]);
  assert.deepEqual(V.heardVelocities(score, played(score))[V.noteId(0, 0, 60)], 64, "the dynamics' velocity, shown when none is set");
});

test("a chord's notes each their own, a tied note once, every pass of a repeat", () => {
  const score = read("\\repeat volta 2 { <c' e'>2 g'2 ~ | g'1 }");
  V.setVelocities(score, { [V.noteId(0, 0, 64)]: 40, [V.noteId(0, Q * 2, 67)]: 110 });
  const out = ons(V.applyVelocities(score, played(score)));
  assert.deepEqual(out, [[60, 90], [64, 40], [67, 110], [60, 90], [64, 40], [67, 110]]);
});

test("two staves on their channels, a voice on its staff's", () => {
  const score = read("<< \\new Staff << { c''4 d'' e'' f'' } \\\\ { c'2 c'2 } >> \\new Staff { \\clef bass c4 c c c } >>");
  const lanes = R.rollNotes(score).map((n) => n.lane);
  assert.deepEqual([...new Set(lanes)].sort(), [0, 1, 2]);
  const voice = R.rollNotes(score).find((n) => M.isLower(score, n.lane));
  const bass = R.rollNotes(score).find((n) => n.key === 48);
  V.setVelocities(score, { [V.noteId(voice.lane, 0, 60)]: 11, [V.noteId(bass.lane, Q, 48)]: 22 });
  const notes = V.midiNoteOns(V.applyVelocities(score, played(score)));
  assert.deepEqual(notes.filter((n) => n.velocity === 11).map((n) => [n.key, n.sec]), [[60, 0]]);
  assert.deepEqual(notes.filter((n) => n.velocity === 22).map((n) => [n.key, n.sec.toFixed(2)]), [[48, "0.60"]]);
  assert.equal(notes.filter((n) => n.velocity === 90).length, 4 + 1 + 3);
});

test("velocities of notes gone are dropped, clamped to 1–127", () => {
  const score = read("{ c'4 d' e' f' }");
  const map = V.setVelocities(score, { [V.noteId(0, 0, 60)]: 400, [V.noteId(0, 0, 61)]: 50, [V.noteId(0, Q, 62)]: -3 });
  assert.deepEqual(map, { "0:0:60": 127, [`0:${Q}:62`]: 1 });
  V.setVelocities(score, { "0:0:60": null, [`0:${Q}:62`]: null });
  assert.equal(score.meta.velocity, undefined, "none left: no key");
});

test("a note dragged on the roll keeps its velocity; a pitch changed in place too", () => {
  const score = read("{ c'4 d' e' f' }");
  V.setVelocities(score, { [V.noteId(0, Q, 62)]: 33, [V.noteId(0, 2 * Q, 64)]: 77 });
  // Dragged: a beat later, two semitones up — the drag's own remap.
  const i = M.moveNote(score, 0, 1, { key: 62, shift: Q, semitones: 2 });
  assert.equal(M.starts(score.staves[0])[i], 2 * Q);
  V.remap(score, 0, Q, 2 * Q, (k) => (k === 62 ? 64 : k));
  assert.equal(V.velocitiesOf(score)[V.noteId(0, 2 * Q, 64)], 33, "the moved note's velocity, over the one it replaced");
  // A pitch changed in place, in the score view: reconciled after the edit.
  const before = structuredClone(score);
  M.setPitch(score, 0, M.eventAt(score.staves[0], 2 * Q), { d: 11, alter: 0 });
  V.reconcile(before, score);
  assert.deepEqual(V.velocitiesOf(score), { [V.noteId(0, 2 * Q, 67)]: 33 }, "e' made g' keeps it");
  // A note deleted: its velocity goes.
  const again = structuredClone(score);
  M.remove(score, 0, M.eventAt(score.staves[0], 2 * Q));
  V.reconcile(again, score);
  assert.deepEqual(V.velocitiesOf(score), {});
});

test("the actions: a fixed velocity, softer, the beats accented", () => {
  const score = read("{ \\time 3/4 c'4 d'8 e' f'4 | g'2. }");
  const ids = V.velocityNotes(score).map((n) => n.id);
  assert.deepEqual(Object.values(V.fixed(ids, 100)), [100, 100, 100, 100, 100]);
  const set = { [ids[0]]: 100 };
  const soft = V.soften(ids, set, {}, 0.5);
  assert.equal(soft[ids[0]], 50);
  assert.equal(soft[ids[1]], 45, "the dynamics' velocity, softened");
  const accented = V.accentBeats(score, ids, {}, {});
  assert.deepEqual(accented, { [ids[0]]: 110, [ids[1]]: 100, [ids[3]]: 100, [ids[4]]: 110 }, "e' is off the beat");
});

test("the played velocities of a recording, for the notes it wrote", () => {
  const score = read("{ \\time 4/4 r1 | r1 }");
  const notes = [
    { key: 60, t0: 30, t1: Q - 30, velocity: 101 },
    { key: 64, t0: Q + 20, t1: 2 * Q, velocity: 44 },
  ];
  M.writeRecording(score, 0, 0, M.barStart(score, 1), notes, M.RECORDING_GRIDS.sixteenth);
  const map = V.fromRecording(score, 0, notes, M.RECORDING_GRIDS.sixteenth);
  assert.deepEqual(map, { [V.noteId(0, 0, 60)]: 101, [V.noteId(0, Q, 64)]: 44 });
});

test("the strip: a bar per note, as tall as it is loud, hit near its x", () => {
  const score = read("{ c'4 d' e' f' }");
  const geo = R.rollLayout(score);
  const bars = V.stripBars(score, geo, { [V.noteId(0, 0, 60)]: 127 }, {});
  assert.equal(bars.length, 4);
  assert.equal(V.yOfVelocity(127), 6);
  assert.equal(V.velocityOfY(V.yOfVelocity(64)), 64);
  assert.equal(V.velocityOfY(-50), 127);
  assert.equal(V.velocityOfY(1000), 1);
  assert.equal(V.barAtX(bars, bars[1].x + 3).id, bars[1].id);
  assert.equal(V.barAtX(bars, bars[1].x + 12), null);
  const svg = V.drawStrip(score, geo, { set: { [V.noteId(0, 0, 60)]: 127 }, selected: new Set([V.noteId(0, Q, 62)]) });
  assert.equal(svg.match(/class="vel-note[ "]/g).length, 4);
  assert.equal(svg.match(/vel-note-heard/g).length, 3);
  assert.equal(svg.match(/vel-note-chosen/g).length, 1);
});

test("the note-ons read through running status, a SysEx and a tempo change", () => {
  // Format 0, 480 a quarter: a SysEx, 120 bpm, C4 at 0, E4 (running status)
  // a quarter later, then 60 bpm, G4 on channel 2 a quarter after that.
  const track = [
    0x00, 0xf0, 0x03, 0x7e, 0x7f, 0xf7,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0x90, 60, 70,
    0x83, 0x60, 64, 80,
    0x00, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40,
    0x83, 0x60, 0x91, 67, 90,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length];
  const bytes = new Uint8Array([...header, ...track]);
  const ons = V.midiNoteOns(bytes);
  assert.deepEqual(ons.map((n) => [n.channel, n.key, n.velocity, n.sec]), [[0, 60, 70, 0], [0, 64, 80, 0.5], [1, 67, 90, 1.5]]);
  assert.equal(bytes[ons[1].at], 80, "`at` is the velocity's byte");
});

test("a grace note's note-on is left alone; the note after it takes its velocity", () => {
  const score = read("{ \\grace d'8 c'4 e'4 f'2 }");
  V.setVelocities(score, { [V.noteId(0, 0, 60)]: 17 });
  const out = ons(V.applyVelocities(score, played(score)));
  assert.deepEqual(out.map(([key]) => key), [62, 60, 64, 65]);
  assert.equal(out[0][1], 90, "the grace note as it was");
  assert.equal(out[1][1], 17);
});

// A score's text is anyone's: a meta line written by hand (or by an attacker)
// must not put markup in the MIDI view (#537).
test("a velocity on the meta line that is no number is dropped, and draws no markup (#537)", () => {
  const payload = "<img src=x onerror=alert(1)>";
  const meta = { velocity: { [V.noteId(0, 0, 60)]: payload, [V.noteId(0, Q, 62)]: 300, [V.noteId(0, 2 * Q, 64)]: 70, [V.noteId(0, 3 * Q, 65)]: "96" } };
  const score = read(`{ c'4 d' e' f' }\n%% eui-score ${JSON.stringify(meta)}\n`);
  // Read, the line keeps only numbers (#683): the rest is left out as it is read.
  assert.equal(score.meta.velocity[V.noteId(0, 0, 60)], undefined, "no markup read");
  assert.equal(score.meta.velocity[V.noteId(0, Q, 62)], 300, "a number kept as written");
  const set = V.velocitiesOf(score);
  assert.deepEqual(set, { [V.noteId(0, Q, 62)]: 127, [V.noteId(0, 2 * Q, 64)]: 70 }, "numbers only, clamped to 1–127");
  const geo = R.rollLayout(score);
  const svg = V.drawStrip(score, geo, { set });
  assert.doesNotMatch(svg, /<img|onerror/);
  assert.match(svg, /<title>127<\/title>/);
  assert.match(svg, /<title>70<\/title>/);
  // Handed a raw map all the same, the strip still writes text, not markup.
  const raw = V.drawStrip(score, geo, { set: meta.velocity });
  assert.doesNotMatch(raw, /<img/);
  assert.equal(raw.match(/class="vel-note[ "]/g).length, 4);
  // Nor does the MIDI get a velocity that is no number.
  const out = ons(V.applyVelocities(score, played(score)));
  assert.deepEqual(out.map(([key]) => key), [60, 62, 64, 65]);
  assert.equal(out[1][1], 127);
  assert.equal(out[2][1], 70);
  assert.ok(out.every(([, v]) => Number.isInteger(v) && v >= 1 && v <= 127));
});

test("a velocity map that is no map reads as none (#537)", () => {
  for (const velocity of ["<img src=x onerror=alert(1)>", [96, 70], 42, null]) {
    const score = read("{ c'4 }");
    score.meta = { velocity };
    assert.deepEqual(V.velocitiesOf(score), {});
  }
  const score = read("{ c'4 }");
  score.meta = JSON.parse('{"velocity":{"__proto__":5,"0:0:60":64}}');
  assert.deepEqual(V.velocitiesOf(score), { "0:0:60": 64 });
});
