// A staff moved up or down (#1024): its voices, its line of chord names and
// its figured bass go with it, a piano's two staves move as one; what the
// settings line keeps by staff (the mixer, the velocities, the part's own
// layout) follows it; a bracket keeps its staves, a staff moved out across
// its edge leaving it and one moved into its middle joining it. The first
// staff goes no higher, the last no lower.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as T from "../../public/eui-score/score-tools.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const open = (src) => M.fromParsed(JSON.parse(score_json(src)), src).score;

const QUARTET = `\\new StaffGroup <<
  \\new Staff \\with { instrumentName = "Flute" } { c''1 }
  \\new Staff \\with { instrumentName = "Oboe" } { << { e''1 } \\\\ { a'1 } >> }
  \\new Staff \\with { instrumentName = "Viola" } { \\clef alto c'1 }
  \\new Staff \\with { instrumentName = "Cello" } { \\clef bass c1 }
>>`;

const names = (score) => M.staffLanes(score).map((s) => score.staves[s].name || (score.staves[s].chords ? "chords" : ""));

test("a staff moved down one: its notes and name go with it, the others close up", () => {
  const score = open(QUARTET);
  assert.deepEqual(names(score), ["Flute", "Oboe", "Viola", "Cello"]);
  T.moveStaff(score, 0, 1);
  assert.deepEqual(names(score), ["Oboe", "Flute", "Viola", "Cello"]);
  assert.equal(score.staves[M.staffLanes(score)[1]].events[0].pitches[0].d, 14);
});

test("a staff of two voices moves with both, voice 2 still under voice 1", () => {
  const score = open(QUARTET);
  T.moveStaff(score, 1, 3);
  assert.deepEqual(names(score), ["Flute", "Viola", "Cello", "Oboe"]);
  const oboe = M.staffLanes(score)[3];
  assert.deepEqual(M.voiceLanes(score, oboe), [3, 4]);
  assert.equal(M.voiceOf(score, 4), 2);
  assert.equal(score.staves[4].events[0].pitches[0].d, 12);
  // Written and read back: the same order.
  const again = open(M.toLilyPond(score).source);
  assert.deepEqual(names(again), ["Flute", "Viola", "Cello", "Oboe"]);
});

test("the mixer, the velocities and the part's layout follow the staff's lanes", () => {
  const score = open(QUARTET);
  score.meta = {
    mixer: { tracks: { 0: { volume: 0.5 }, 3: { pan: -0.4 }, "audio-1": { volume: 1 } } },
    velocity: { "0:0:72": 90, "2:0:57": 40 },
    parts: { 0: { staffSize: 18 } },
  };
  // The flute (lane 0) goes under the oboe's two lanes: to lane 2.
  T.moveStaff(score, 0, 1);
  assert.deepEqual(score.meta.mixer.tracks[2], { volume: 0.5 });
  assert.equal(score.meta.mixer.tracks[0], undefined);
  // The viola (lane 3) did not move.
  assert.deepEqual(score.meta.mixer.tracks[3], { pan: -0.4 });
  // An audio track is no staff's.
  assert.deepEqual(score.meta.mixer.tracks["audio-1"], { volume: 1 });
  // The oboe's voice 2 (lane 2) is lane 1 now.
  assert.deepEqual(score.meta.velocity, { "2:0:72": 90, "1:0:57": 40 });
  assert.deepEqual(score.meta.parts, { 2: { staffSize: 18 } });
});

test("a piano's two staves move as one, their brace with them", () => {
  const score = M.fromTemplate("voice-piano", { bars: 2 });
  assert.deepEqual(T.staffUnits(score), [[0], [1, 2]]);
  T.moveStaff(score, 0, 1);
  assert.equal(score.staves[2].instrument, M.INSTRUMENTS.find((it) => it.name === "Voice").sound);
  assert.deepEqual(score.groups.map((g) => [g.kind, g.first, g.last]), [["brace", 0, 1]]);
});

test("a line of chord names goes with the staff under it, a figured bass with the staff over it", () => {
  const score = open(QUARTET);
  M.addChordStaff(score, M.staffLanes(score)[2]);
  M.addFigureStaff(score, M.staffLanes(score)[4]);
  assert.deepEqual(T.staffUnits(score), [[0], [1], [2, 3], [4, 5]]);
  T.moveStaff(score, 2, 0);
  const lanes = M.staffLanes(score);
  assert.ok(score.staves[lanes[0]].chords);
  assert.equal(score.staves[lanes[1]].name, "Viola");
  assert.equal(score.staves[lanes[2]].name, "Flute");
  T.moveStaff(score, 3, 2);
  assert.equal(score.staves[M.staffLanes(score)[3]].name, "Cello");
  assert.ok(score.staves[M.staffLanes(score)[4]].figures);
});

test("a bracket keeps its staves: a staff moved out across its edge leaves it, one moved into its middle joins it", () => {
  const score = open(QUARTET);
  score.groups = [{ kind: "bracket", first: 0, last: 1, name: "", short: "" }];
  // The oboe (the bracket's last) below the viola: out of the bracket.
  T.moveStaff(score, 1, 2);
  assert.deepEqual(names(score), ["Flute", "Viola", "Oboe", "Cello"]);
  assert.deepEqual(score.groups.map((g) => [g.first, g.last]), [[0, 0]]);
  // Moved within a group: the group is as it was.
  score.groups = [{ kind: "bracket", first: 0, last: 2, name: "", short: "" }];
  T.moveStaff(score, 0, 1);
  assert.deepEqual(score.groups.map((g) => [g.first, g.last]), [[0, 2]]);
  // The cello into the middle of a bracket of the first and the third: in it.
  score.groups = [{ kind: "bracket", first: 0, last: 1, name: "", short: "" }];
  T.moveStaff(score, 3, 1);
  assert.deepEqual(score.groups.map((g) => [g.first, g.last]), [[0, 2]]);
});

test("the first staff goes no higher, the last no lower, a lone staff nowhere; nothing changes", () => {
  const score = open(QUARTET);
  const before = JSON.stringify(score);
  assert.throws(() => T.moveStaff(score, 0, -1), /first/);
  assert.throws(() => T.moveStaff(score, 3, 4), /last/);
  assert.throws(() => T.moveStaff(score, 7, 0), /no such staff/);
  assert.equal(JSON.stringify(score), before);
  const lone = open("{ c'1 }");
  assert.throws(() => T.moveStaff(lone, 0, 1), /one staff/);
});

test("the unit of a lane: the voice, the chord line and the staff itself all answer the same", () => {
  const score = open(QUARTET);
  M.addChordStaff(score, 1);
  // Flute 0 · chords 1 · oboe 2, 3 · viola 4 · cello 5.
  assert.equal(T.unitOf(score, 1), 1);
  assert.equal(T.unitOf(score, 2), 1);
  assert.equal(T.unitOf(score, 3), 1);
  assert.equal(T.unitOf(score, 5), 3);
});

test("the lanes' map answered: each lane's new place, to keep a selection on what moved", () => {
  const score = open(QUARTET);
  const moved = T.moveStaff(score, 0, 2);
  // Flute 0 → 3; oboe 1, 2 → 0, 1; viola 3 → 2; cello stays.
  assert.deepEqual(moved, [3, 0, 1, 2, 4]);
});

test("Alt+Shift+↑ ↓ move the staff; Alt+↑ ↓ still go from note to note of a chord", async () => {
  const { resolveKey } = await import("../../public/eui-score/shortcuts.js");
  const key = (k, more) => ({ key: k, code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...more });
  assert.deepEqual(resolveKey(key("ArrowUp", { altKey: true, shiftKey: true })), ["move-staff", { by: "-1" }]);
  assert.deepEqual(resolveKey(key("ArrowDown", { altKey: true, shiftKey: true })), ["move-staff", { by: "1" }]);
  assert.deepEqual(resolveKey(key("ArrowUp", { altKey: true })), ["head-up", {}]);
  assert.deepEqual(resolveKey(key("ArrowUp", { shiftKey: true })), ["move", { how: "semitone", by: 1 }]);
});
