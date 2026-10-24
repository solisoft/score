// MPE input (public/eui-score/mpe.js, #391), fed synthetic MIDI: the zone
// found from the MPE Configuration Message or set by hand, each note's
// bend and pressure on its member channel, the bend ranges, and what a
// staff's curves keep of it all. And the "pressure" curve it records into
// (automation.js).
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { MpeInput, configurationMessage, MEMBER_RANGE } from "../../public/eui-score/mpe.js";
import * as A from "../../public/eui-score/automation.js";

const feed = (mpe, messages) => messages.flatMap((m) => mpe.message(m));
/** A bend message on `channel` (0–15) of `raw` (−8192 to 8191). */
const bend = (channel, raw) => [0xe0 | channel, (raw + 8192) & 127, (raw + 8192) >> 7];

test("the MPE Configuration Message turns a lower zone on, with its member channels; a keyboard without it is not MPE", () => {
  const mpe = new MpeInput();
  assert.equal(mpe.active, false);
  // Without a zone, notes and bends on channels 2–16 mean nothing to MPE.
  assert.deepEqual(feed(mpe, [[0x91, 60, 100], bend(1, 4096), [0xd1, 80]]), []);
  assert.deepEqual(configurationMessage(15), [[0xb0, 101, 0], [0xb0, 100, 6], [0xb0, 6, 15]]);
  assert.deepEqual(feed(mpe, configurationMessage(15)), [{ type: "zone", zone: "lower", members: 15 }]);
  assert.equal(mpe.active, true);
  assert.equal(mpe.zoneOf(1), "lower");
  assert.equal(mpe.zoneOf(15), "lower");
  assert.equal(mpe.zoneOf(0), null, "channel 1 is the manager");
  assert.equal(mpe.managerOf(0), "lower");
  // Turned off by a configuration of 0 members.
  assert.deepEqual(feed(mpe, configurationMessage(0)), [{ type: "zone", zone: "lower", members: 0 }]);
  assert.equal(mpe.active, false);
});

test("an RPN other than 6, or data entry with no RPN chosen, is not a configuration", () => {
  const mpe = new MpeInput();
  assert.deepEqual(feed(mpe, [[0xb0, 6, 15]]), [], "no RPN chosen");
  assert.deepEqual(feed(mpe, [[0xb0, 101, 0], [0xb0, 100, 5], [0xb0, 6, 15]]), [], "RPN 5");
  assert.deepEqual(feed(mpe, [[0xb3, 101, 0], [0xb3, 100, 6], [0xb3, 6, 15]]), [], "on a channel that manages no zone");
  assert.equal(mpe.active, false);
});

test("each note's own bend and pressure, on its member channel; another note's untouched", () => {
  const mpe = new MpeInput();
  feed(mpe, configurationMessage(15));
  assert.deepEqual(feed(mpe, [[0x91, 60, 100], [0x92, 64, 90]]), [
    { type: "noteOn", channel: 1, key: 60, velocity: 100 },
    { type: "noteOn", channel: 2, key: 64, velocity: 90 },
  ]);
  // A quarter of the way up on 48 semitones: +12 for C, nothing for E.
  assert.deepEqual(feed(mpe, [bend(1, 2048)]), [{ type: "bend", key: 60, semitones: 12 }]);
  assert.deepEqual(feed(mpe, [bend(2, -8192)]), [{ type: "bend", key: 64, semitones: -MEMBER_RANGE }]);
  assert.deepEqual(feed(mpe, [[0xd2, 100]]), [{ type: "pressure", key: 64, value: 100 }]);
  assert.deepEqual(feed(mpe, [[0xb1, 74, 30]]), [{ type: "slide", key: 60, value: 30 }]);
  // The manager's bend moves every note, on its own range (2).
  assert.deepEqual(feed(mpe, [bend(0, 8191)]), [{ type: "bend", key: null, semitones: (8191 / 8192) * 2 }]);
  // A note let go: its channel's bend means nothing until the next note.
  assert.deepEqual(feed(mpe, [[0x81, 60, 0]]), [{ type: "noteOff", channel: 1, key: 60 }]);
  assert.deepEqual(feed(mpe, [bend(1, 100)]), []);
  assert.deepEqual(feed(mpe, [[0xd1, 50]]), []);
  // A note-off for another key on that channel is not this note's.
  assert.deepEqual(feed(mpe, [[0x82, 70, 0]]), []);
  // A note-on of velocity 0 lets go, as a note-off.
  assert.deepEqual(feed(mpe, [[0x92, 64, 0]]), [{ type: "noteOff", channel: 2, key: 64 }]);
  // Clock and sysex mean nothing.
  assert.deepEqual(feed(mpe, [[0xf8], [0xf0, 1, 0xf7]]), []);
});

test("the bend ranges: RPN 0 on a member sets every member's; on the manager, its own", () => {
  const mpe = new MpeInput();
  feed(mpe, configurationMessage(4));
  assert.equal(mpe.rangeOf(3), 48);
  feed(mpe, [[0xb3, 101, 0], [0xb3, 100, 0], [0xb3, 6, 24]]);
  assert.equal(mpe.rangeOf(1), 24, "set on channel 4, every member's");
  assert.equal(mpe.rangeOf(4), 24);
  feed(mpe, [[0x91, 62, 80]]);
  assert.deepEqual(feed(mpe, [bend(1, 4096)]), [{ type: "bend", key: 62, semitones: 12 }]);
  feed(mpe, [[0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 12]]);
  assert.equal(mpe.rangeOf(0), 12, "the manager's own");
  assert.equal(mpe.rangeOf(2), 24, "the members' unchanged");
  // Channel 6 is not in a zone of 4 members.
  assert.equal(mpe.zoneOf(5), null);
  assert.deepEqual(feed(mpe, [[0x95, 60, 80]]), []);
});

test("an upper zone, beside a lower one: the zones never share a channel", () => {
  const mpe = new MpeInput();
  feed(mpe, configurationMessage(7));
  assert.deepEqual(feed(mpe, configurationMessage(7, "upper")), [{ type: "zone", zone: "upper", members: 7 }]);
  assert.equal(mpe.zoneOf(14), "upper");
  assert.equal(mpe.zoneOf(8), "upper");
  assert.equal(mpe.zoneOf(7), "lower");
  assert.equal(mpe.managerOf(15), "upper");
  // The upper zone grown to 10: the lower shrinks to what is left (14 − 10 = 4).
  feed(mpe, configurationMessage(10, "upper"));
  assert.equal(mpe.zones.lower, 4);
  assert.equal(mpe.zoneOf(5), "upper");
  assert.equal(mpe.zoneOf(4), "lower");
});

test("an MPE keyboard set by hand: a lower zone of fifteen from the start", () => {
  const mpe = new MpeInput({ manual: true });
  assert.equal(mpe.active, true);
  assert.deepEqual(feed(mpe, [[0x93, 67, 70], bend(3, -4096)]), [
    { type: "noteOn", channel: 3, key: 67, velocity: 70 },
    { type: "bend", key: 67, semitones: -24 },
  ]);
});

test("what a staff's curves keep: the bend of the note struck last at ±2 semitones, the hardest pressure", () => {
  const mpe = new MpeInput({ manual: true });
  assert.equal(mpe.staffBend(), 0);
  assert.equal(mpe.staffPressure(), 0);
  feed(mpe, [[0x91, 60, 100], [0x92, 64, 100]]);
  // C bent a semitone and a half (256 of 8192, on 48), E not: E was struck last, so nothing.
  feed(mpe, [bend(1, 256)]);
  assert.equal(mpe.staffBend(), 0);
  // E bent a semitone and a half: three quarters of the staff's ±2.
  feed(mpe, [bend(2, 256)]);
  assert.equal(mpe.staffBend(), 6144);
  // Past ±2 semitones: held at the end.
  feed(mpe, [bend(2, 8191)]);
  assert.equal(mpe.staffBend(), 8191);
  feed(mpe, [bend(2, -8192)]);
  assert.equal(mpe.staffBend(), -8192);
  feed(mpe, [[0xd1, 30], [0xd2, 90]]);
  assert.equal(mpe.staffPressure(), 90);
  // E let go: C's bend and pressure are what is left.
  feed(mpe, [[0x82, 64, 0]]);
  assert.equal(mpe.staffBend(), 6144);
  assert.equal(mpe.staffPressure(), 30);
});

test("the Pressure curve: kept 0–127, written as channel pressure on the staff's channel", () => {
  const c = A.controller("pressure");
  assert.equal(c.name, "Pressure");
  assert.deepEqual(A.normalize("pressure", [[0, 200], [480, -3], [480, 64]]), [[0, 127], [480, 64]]);
  assert.deepEqual(A.eventBytes(3, "pressure", 90), [0xd3, 90]);
  assert.deepEqual(A.eventBytes(19, "pressure", 150), [0xd3, 127], "a second port's channel, in its port");
  // Not a controller number: a CC never lands on it.
  assert.equal(A.idOfNumber(null), null);
  assert.equal(A.idOfNumber(1), "1");
});
