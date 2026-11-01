// Automation curves (public/eui-score/automation.js): kept in the score's
// text under `cc`, edited point by point, thinned when recorded, and laid
// into the MIDI the real engraver writes — on every pass of a repeat, in
// each staff's own track, the notated pedal first.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as A from "../../public/eui-score/automation.js";
import * as I from "../../public/eui-score/midi-import.js";
import * as R from "../../public/eui-score/piano-roll.js";
import * as F from "../../public/eui-score/feel.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => {
  const score = M.fromParsed(JSON.parse(score_json(source))).score;
  score.meta = M.readMeta(source);
  return score;
};
const Q = M.WHOLE / 4;
/** The MIDI as Play writes it: every repeat played out. */
const played = (score) => midi(M.toLilyPond(score, { unfold: true }).source, M.DEFAULT_BPM, 4, 0);
/** Each track's channel events: [{ tick, bytes }] (bytes as an array). */
const channelEvents = (bytes) => F.readSmf(bytes).tracks.map((t) => t.filter((e) => e.data[0] < 0xf0).map((e) => ({ tick: e.tick, bytes: [...e.data] })));
const controllers = (events, number) => events.filter((e) => (e.bytes[0] & 0xf0) === 0xb0 && e.bytes[1] === number);

test("the curves: kept on the meta line under cc, beside the other features' keys", () => {
  const score = read("{ c'4 d' e' f' }\n%% eui-score {\"velocity\":{\"0:0:60\":30}}\n");
  const kept = A.setCurve(score, 0, "1", [[Q, 300], [0, 10.4], [Q, 64], [-5, 2]]);
  assert.deepEqual(kept, [[0, 2], [Q, 64]], "sorted, in range, one a tick (the last wins), from 0");
  A.setCurve(score, 0, "64", [[0, 100], [Q, 20]]);
  assert.deepEqual(A.curveOf(score, 0, "64"), [[0, 127], [Q, 0]], "the pedal is on or off");
  A.setCurve(score, 0, "bend", [[0, -9000], [Q, 9000]]);
  assert.deepEqual(A.curveOf(score, 0, "bend"), [[0, -8192], [Q, 8191]]);
  const { source } = M.toLilyPond(score);
  const meta = M.readMeta(source);
  assert.deepEqual(meta.velocity, { "0:0:60": 30 }, "the velocities kept");
  assert.deepEqual(meta.cc, { 0: { 1: [[0, 2], [Q, 64]], 64: [[0, 127], [Q, 0]], bend: [[0, -8192], [Q, 8191]] } });
  assert.deepEqual(JSON.parse(score_json(source)).warnings, [], "the engraver passes over it");
  // Emptied, curve by curve: the key goes.
  for (const id of ["1", "64", "bend"]) A.setCurve(score, 0, id, []);
  assert.equal(M.readMeta(M.toLilyPond(score).source).cc, undefined);
  assert.throws(() => A.setCurve(score, 0, "74", [[0, 1]]), /No such controller/);
});

test("a curve's value: a ramp between points, the pedal steps, held after the last, nothing before the first", () => {
  const ramp = [[Q, 0], [3 * Q, 100]];
  assert.equal(A.valueAt(ramp, 0, "1"), null);
  assert.equal(A.valueAt(ramp, Q, "1"), 0);
  assert.equal(A.valueAt(ramp, 2 * Q, "1"), 50);
  assert.equal(A.valueAt(ramp, 9 * Q, "1"), 100);
  assert.equal(A.valueAt([[0, 127], [2 * Q, 0]], Q, "64"), 127);
});

test("points added, moved and taken away", () => {
  let points = A.withPoint("11", [], Q, 40);
  points = A.withPoint("11", points, 0, 100);
  assert.deepEqual(points, [[0, 100], [Q, 40]]);
  assert.deepEqual(A.movePoint("11", points, 1, 2 * Q, 90), [[0, 100], [2 * Q, 90]]);
  assert.deepEqual(A.movePoint("11", points, 1, 0, 5), [[0, 5]], "onto another point: that one gives way");
  assert.deepEqual(A.withoutPoint("11", points, 0), [[Q, 40]]);
});

test("thinned: a straight sweep keeps its ends, a held value its first and last, the pedal its changes", () => {
  const sweep = Array.from({ length: 50 }, (_, k) => [k * 100, k * 2]);
  assert.deepEqual(A.thin("1", sweep), [[0, 0], [4900, 98]]);
  const bump = [...Array.from({ length: 10 }, (_, k) => [k * 10, k * 10]), ...Array.from({ length: 10 }, (_, k) => [100 + k * 10, 90 - k * 10])];
  const kept = A.thin("1", bump);
  assert.ok(kept.length <= 4 && kept.some(([, v]) => v >= 90), JSON.stringify(kept));
  assert.deepEqual(A.thin("64", [[0, 127], [10, 127], [20, 0], [30, 0], [40, 127]]), [[0, 127], [20, 0], [40, 127]]);
  assert.deepEqual(A.thin("7", [[0, 50], [10, 50], [20, 50]]), [[0, 50], [20, 50]]);
});

test("a recording's knobs replace the curve between its bars, and leave the rest", () => {
  const score = read("{ c'1 d' e' }");
  A.setCurve(score, 0, "1", [[0, 10], [M.WHOLE + Q, 20], [2 * M.WHOLE + Q, 30]]);
  A.writeRecorded(score, 0, { 1: [[M.WHOLE, 0], [M.WHOLE + 10, 0], [M.WHOLE + Q, 64]], 99: [[0, 1]], bend: [] }, M.WHOLE, 2 * M.WHOLE);
  assert.deepEqual(A.curveOf(score, 0, "1"), [[0, 10], [M.WHOLE, 0], [M.WHOLE + Q, 64], [2 * M.WHOLE + Q, 30]]);
  assert.deepEqual(A.curveOf(score, 0, "bend"), [], "nothing played, nothing kept");
});

test("in the MIDI: a ramp becomes a value every sixteenth, at its time, in its staff's track", () => {
  const score = read("<< \\new Staff { c'4 d' e' f' } \\new Staff { \\clef bass c4 d e f } >>");
  A.setCurve(score, 1, "1", [[0, 0], [Q, 120]]);
  const out = A.applyAutomation(score, played(score));
  const tracks = channelEvents(out);
  assert.equal(tracks.length, 2, "no track added");
  assert.equal(controllers(tracks[0], 1).length, 0, "not the other staff's");
  const mod = controllers(tracks[1], 1);
  assert.deepEqual(mod.map((e) => e.bytes[2]), [0, 30, 60, 90, 120], "four steps a beat");
  assert.ok(mod.every((e) => (e.bytes[0] & 15) === 1), "on the staff's channel");
  // At the time of the notes: the second value a sixteenth in, the last on beat two, before its note.
  const ppq = F.readSmf(out).division;
  assert.deepEqual(mod.map((e) => e.tick), [0, ppq / 4, ppq / 2, (3 * ppq) / 4, ppq]);
  const atBeatTwo = tracks[1].filter((e) => e.tick === ppq);
  assert.ok(atBeatTwo.findIndex((e) => e.bytes[1] === 1 && (e.bytes[0] & 0xf0) === 0xb0) < atBeatTwo.findIndex((e) => (e.bytes[0] & 0xf0) === 0x90 && e.bytes[2] > 0), "the controller before the note it colours");
  // Still a MIDI file anyone reads: the notes are all there.
  const again = I.parseMidi(out);
  assert.equal(again.tracks.flatMap((t) => t.events).filter((e) => e.kind === "on").length, 8);
  assert.equal(A.applyAutomation(read("{ c'4 }"), played(read("{ c'4 }"))).length, played(read("{ c'4 }")).length, "nothing to add: the same bytes");
});

test("in the MIDI: a repeat plays its bars' curve again; a value is sent only where it changes", () => {
  const score = read("\\repeat volta 2 { c'1 } d'1");
  A.setCurve(score, 0, "11", [[0, 40], [M.WHOLE, 100]]);
  const ccs = controllers(channelEvents(A.applyAutomation(score, played(score)))[0], 11);
  const ppq = F.readSmf(played(score)).division;
  const at = (beat) => ccs.filter((e) => e.tick === beat * ppq).map((e) => e.bytes[2]);
  // Bar 1, first pass: from 40 up, a value every sixteenth.
  assert.equal(ccs.filter((e) => e.tick < 4 * ppq).length, 16);
  assert.deepEqual(at(0), [40]);
  // Back to bar 1 for its second pass: 40 again.
  assert.deepEqual(at(4), [40]);
  assert.equal(ccs.filter((e) => e.tick >= 4 * ppq && e.tick < 8 * ppq).length, 16);
  // Bar 2: 100, once.
  assert.deepEqual(ccs.filter((e) => e.tick >= 8 * ppq).map((e) => [e.tick / ppq, e.bytes[2]]), [[8, 100]]);
});

test("in the MIDI: the pedal of the notation wins over the curve; pitch bend is two bytes from the centre", () => {
  const pedalled = read("{ c'4\\sustainOn d' e'\\sustainOff f' }");
  A.setCurve(pedalled, 0, "64", [[0, 0], [Q, 127]]);
  A.setCurve(pedalled, 0, "bend", [[0, 0], [Q, 8191]]);
  assert.equal(A.notatedPedal(pedalled, 0), true);
  const events = channelEvents(A.applyAutomation(pedalled, played(pedalled)))[0];
  assert.deepEqual(controllers(events, 64).map((e) => e.bytes[2]), [127, 0], "only the notation's");
  const bends = events.filter((e) => (e.bytes[0] & 0xf0) === 0xe0);
  assert.deepEqual(bends[0].bytes, [0xe0, 0, 64], "the centre");
  assert.deepEqual(bends.at(-1).bytes, [0xe0, 127, 127], "all the way up");
  const plain = read("{ c'4 d' e' f' }");
  A.setCurve(plain, 0, "64", [[0, 127], [2 * Q, 0]]);
  assert.equal(A.notatedPedal(plain, 0), false);
  assert.deepEqual(controllers(channelEvents(A.applyAutomation(plain, played(plain)))[0], 64).map((e) => e.bytes[2]), [127, 0], "the curve, on a staff without marks");
});

test("Save as MIDI: the mixer's volume and pan at each staff's start, its volume curve scaled by the fader", () => {
  const score = read("<< \\new Staff { c'4 } \\new Staff { c'4 } >>");
  A.setCurve(score, 0, "7", [[0, 100]]);
  const mix = { tracks: { 0: { volume: -6, pan: -1 }, 1: { volume: -60 } } };
  const tracks = channelEvents(A.applyAutomation(score, played(score), { mix }));
  const first = tracks[0].filter((e) => e.tick === 0 && (e.bytes[0] & 0xf0) === 0xb0);
  assert.deepEqual(controllers(first, 7).map((e) => e.bytes[2]), [A.volumeCc(-6), Math.round(100 * 10 ** (-6 / 40))]);
  assert.equal(A.volumeCc(-6), 71);
  assert.deepEqual(controllers(first, 10).map((e) => e.bytes[2]), [0], "hard left");
  assert.deepEqual(controllers(tracks[1], 7).map((e) => e.bytes[2]), [0], "the fader at the bottom: silent");
  assert.deepEqual(controllers(tracks[1], 10).map((e) => e.bytes[2]), [64], "centred");
  assert.equal(A.volumeCc(0), 100, "0 dB is General MIDI's default");
  assert.equal(A.volumeCc(6), 127);
  assert.equal(A.panCc(1), 127);
});

test("a staff that plays no note gets a track of its own for its curve", () => {
  const score = read("<< \\new Staff { c'4 } \\new Staff { r4 } >>");
  A.setCurve(score, 1, "1", [[0, 5]]);
  const bytes = played(score);
  const before = F.readSmf(bytes).tracks.length;
  const smf = F.readSmf(A.applyAutomation(score, bytes));
  const mine = smf.tracks.find((t) => t.some((e) => e.data[0] === 0xb1 && e.data[1] === 1));
  assert.ok(mine, "the curve is written");
  assert.deepEqual(mine.at(-1).data, [0xff, 0x2f, 0], "its track ended");
  assert.ok(smf.tracks.length >= before);
  assert.deepEqual(A.mergeEvents([], [{ tick: 3, data: [0xb3, 1, 5] }]), [{ tick: 3, data: [0xb3, 1, 5] }, { tick: 3, data: [0xff, 0x2f, 0] }]);
});

test("a fermata's hold: the curve's point lands with the note after it, as the engraver holds it", () => {
  const score = read("{ c'4\\fermata d' e' f' }");
  A.setCurve(score, 0, "11", [[0, 10], [Q, 100]]);
  const events = channelEvents(A.applyAutomation(score, played(score)))[0];
  const d = events.find((e) => (e.bytes[0] & 0xf0) === 0x90 && e.bytes[1] === 62 && e.bytes[2] > 0);
  const last = controllers(events, 11).at(-1);
  assert.deepEqual([last.tick, last.bytes[2]], [d.tick, 100]);
});

test("the lane under the roll: its curve, its points, where a click lands", () => {
  const score = read("{ c'4 d' e' f' }");
  const points = [[0, 0], [2 * Q, 127]];
  const geo = R.rollLayout(score, { layout: "tracks" });
  const svg = A.drawLane(score, geo, "1", points, { label: "Piano <1>", chosen: 1, muted: "" });
  assert.match(svg, /class="cc-strip"/);
  assert.equal(svg.match(/data-cc-point=/g).length, 2);
  assert.match(svg, /cc-point-chosen/);
  assert.match(svg, /Piano &lt;1&gt;/);
  assert.match(A.drawLane(score, geo, "64", [], { muted: "not heard" }), /Click to add a point.*not heard/);
  const pedal = A.drawLane(score, geo, "64", [[0, 127], [Q, 0]]);
  assert.equal(pedal.match(/points="([^"]*)"/)[1].split(" ").length, 4, "a step: down at the second point, then on to the end");
  assert.equal(A.pointAt(geo, "1", points, geo.x(2 * Q), A.yOfValue("1", 127)), 1);
  assert.equal(A.pointAt(geo, "1", points, geo.x(Q), A.yOfValue("1", 127)), -1);
  assert.equal(A.tickOfX(geo, geo.x(Q) + 1), Q, "on the 32nd grid");
  assert.equal(A.valueOfY("1", A.yOfValue("1", 90)), 90);
  assert.equal(A.valueOfY("bend", A.yOfValue("bend", 0)), 0);
  assert.deepEqual([A.valueText("64", 127), A.valueText("bend", 5), A.valueText("bend", -5), A.valueText("1", 7)], ["on", "+5", "-5", "7"]);
  assert.deepEqual([A.idOfNumber(64), A.idOfNumber(74), A.controller("bend").name], ["64", null, "Pitch bend"]);
});

// A score's text is anyone's: a curve written by hand (or by an attacker) on
// the meta line must not put markup in the MIDI view (#537).
test("a curve on the meta line is read as numbers: no markup drawn, values in range (#537)", () => {
  const payload = "<img src=x onerror=alert(1)>";
  const cc = { 0: { 1: [[0, payload], [Q, 300], ["<b>", 5], [2 * Q, 40], 7, "x"], bend: [[0, -20000]], nonsense: [[0, 1]], 64: payload }, "<i>": { 1: [[0, 1]] } };
  const score = read(`{ c'4 d' e' f' }\n%% eui-score ${JSON.stringify({ cc })}\n`);
  assert.deepEqual(A.curveOf(score, 0, "1"), [[Q, 127], [2 * Q, 40]], "the value that is no number gone, the others clamped");
  assert.deepEqual(A.curveOf(score, 0, "bend"), [[0, -8192]]);
  assert.deepEqual(A.curveOf(score, 0, "64"), []);
  assert.deepEqual(Object.keys(A.curvesOf(score)), ["0"], "no lane that is no staff's");
  assert.deepEqual(Object.keys(A.curvesOf(score)[0]).sort(), ["1", "bend"], "no controller not followed");
  const geo = R.rollLayout(score, { layout: "tracks" });
  const svg = A.drawLane(score, geo, "1", A.curveOf(score, 0, "1"));
  assert.doesNotMatch(svg, /<img|onerror|NaN/);
  assert.equal(svg.match(/data-cc-point=/g).length, 2);
  // Handed raw points all the same, the lane still writes text, not markup.
  const raw = A.drawLane(score, geo, "1", [[0, payload]]);
  assert.doesNotMatch(raw, /<img/);
  // And the MIDI gets only numbers.
  assert.doesNotThrow(() => A.applyAutomation(score, played(score)));
});

test("a curves map that is no map reads as none (#537)", () => {
  for (const cc of ["<img src=x onerror=alert(1)>", [[0, 1]], 42, null, { 0: "<img>" }]) {
    const score = read("{ c'4 }");
    score.meta = { cc };
    assert.deepEqual(A.curvesOf(score), {});
    assert.deepEqual(A.curveOf(score, 0, "1"), []);
  }
});
