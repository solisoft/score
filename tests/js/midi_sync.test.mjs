// The MIDI clock sent and followed, MIDI learn and the output's latency
// (public/eui-score/midi-sync.js, and its hooks in player.js), against a
// fake MIDIOutput and a fake clock.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../../public/eui-score/midi-sync.js";
import * as P from "../../public/eui-score/player.js";

const WHOLE = 80640;

/** A MIDIOutput that keeps what it is sent: [{ data, at }]. */
class FakeOutput {
  constructor() {
    this.sent = [];
  }
  send(data, at) {
    this.sent.push({ data: Array.from(data), at });
  }
  of(status) {
    return this.sent.filter((m) => m.data[0] === status);
  }
}

/** Passes as score-model.js's playback() gives them: 4/4 bars at `bpm` quarters a minute. */
function passes(bars, bpm = 120, base = 4) {
  const bar = (60 / bpm) * 4 * (base / 4);
  return Array.from({ length: bars }, (_, k) => ({ bar: k, start: k * bar, end: (k + 1) * bar, bpm, base, holds: [] }));
}

test("a timeline counts the quarters of every pass, whatever the beat's unit", () => {
  const line = S.timeline(passes(2, 120), WHOLE);
  assert.deepEqual(line.map((p) => [p.q0, p.q]), [[0, 4], [4, 4]]);
  // Dotted-quarter beats are not here: a beat of eighths at 120 is a quarter at 60.
  const eighths = S.timeline([{ start: 0, end: 4, bpm: 120, base: 8, holds: [] }], WHOLE);
  assert.equal(eighths[0].q, 4);
  assert.equal(S.quarterAt(line, 1), 2);
  assert.equal(S.secAtQuarter(line, 6), 3);
  // Past the end, at the last speed.
  assert.equal(S.secAtQuarter(line, 8), 4);
  assert.equal(S.quarterAt([], 3), 0);
});

test("a fermata's held time is not counted as quarters: its bar's pulses stretch", () => {
  // A 4/4 bar at 60 with a held quarter: five seconds, four quarters.
  const line = S.timeline([{ start: 0, end: 5, bpm: 60, base: 4, holds: [{ at: WHOLE / 4, ticks: WHOLE / 4 }] }], WHOLE);
  assert.equal(line[0].q, 4);
  assert.equal(S.secAtQuarter(line, 2), 2.5);
});

test("the clock sends 24 pulses a quarter, each with its timestamp, at the tempo", () => {
  const port = new FakeOutput();
  let now = 1000;
  const clock = new S.ClockSender(port, { now: () => now, lookahead: 0.1 });
  const line = S.timeline(passes(4, 120), WHOLE);
  const handle = { time: 0, rate: 1, paused: false };
  for (let step = 0; step < 21; step++) {
    clock.tick(handle, line);
    now += 25;
    handle.time += 0.025;
  }
  assert.deepEqual(port.sent[0].data, [0xfa], "Start, from the very beginning");
  const pulses = port.of(0xf8);
  // Half a second played and a tenth ahead: 0.6 s at a quarter a half second.
  assert.ok(pulses.length >= 28 && pulses.length <= 30, `${pulses.length} pulses`);
  const quarter = 500 / 24;
  pulses.forEach((p, k) => assert.ok(Math.abs(p.at - (1000 + k * quarter)) < 1e-6, `pulse ${k} at ${p.at}`));
  // Each is sent ahead of its time, never twice.
  assert.equal(new Set(pulses.map((p) => p.at)).size, pulses.length);
});

test("a tempo change in the score spaces the pulses as the new tempo", () => {
  const port = new FakeOutput();
  let now = 0;
  const clock = new S.ClockSender(port, { now: () => now, lookahead: 4 });
  // A bar at 120, then a bar at 60.
  const line = S.timeline([{ start: 0, end: 2, bpm: 120, base: 4, holds: [] }, { start: 2, end: 6, bpm: 60, base: 4, holds: [] }], WHOLE);
  clock.tick({ time: 0, rate: 1, paused: false }, line);
  const at = port.of(0xf8).map((p) => p.at);
  assert.ok(Math.abs(at[1] - at[0] - 500 / 24) < 1e-6);
  // Pulse 96 is the second bar's first; after it, a quarter is a second.
  assert.ok(Math.abs(at[96] - 2000) < 1e-6);
  assert.ok(Math.abs(at[97] - at[96] - 1000 / 24) < 1e-6);
});

test("the playback's speed changes the pulses' spacing, from where the music is", () => {
  const port = new FakeOutput();
  let now = 0;
  const clock = new S.ClockSender(port, { now: () => now, lookahead: 0.05 });
  const line = S.timeline(passes(4, 120), WHOLE);
  const handle = { time: 0, rate: 1, paused: false };
  for (; now < 500; now += 25, handle.time += 0.025) clock.tick(handle, line);
  handle.rate = 2;
  const before = port.of(0xf8).length;
  clock.tick(handle, line);
  const fresh = port.of(0xf8).slice(before).map((p) => p.at);
  assert.ok(fresh.length > 1);
  assert.ok(Math.abs(fresh[1] - fresh[0] - 250 / 24) < 1e-6, "twice as fast");
});

test("from the middle of the piece, Song Position then Continue; pause sends Stop; play on, Continue again", () => {
  const port = new FakeOutput();
  let now = 0;
  const clock = new S.ClockSender(port, { now: () => now });
  const line = S.timeline(passes(8, 120), WHOLE);
  // Bar 3 (two seconds in) is quarter 4: sixteenth 16.
  const handle = { time: 2, rate: 1, paused: false };
  clock.tick(handle, line);
  assert.deepEqual(port.sent[0].data, [0xf2, 16, 0]);
  assert.deepEqual(port.sent[1].data, [0xfb]);
  assert.equal(port.of(0xfa).length, 0, "no Start: it is not the beginning");
  handle.paused = true;
  clock.tick(handle, line);
  clock.tick(handle, line);
  assert.equal(port.of(0xfc).length, 1, "one Stop");
  handle.paused = false;
  now = 3000;
  clock.tick(handle, line);
  assert.equal(port.of(0xfb).length, 2);
  clock.stop();
  assert.equal(port.of(0xfc).length, 2);
});

test("a jump — a seek, the loop back — stops the device, says where, and goes on", () => {
  const port = new FakeOutput();
  let now = 0;
  const clock = new S.ClockSender(port, { now: () => now });
  const line = S.timeline(passes(8, 120), WHOLE);
  const handle = { time: 0, rate: 1, paused: false };
  clock.tick(handle, line);
  now = 25;
  handle.time = 6; // bar 4
  clock.tick(handle, line);
  assert.deepEqual(port.of(0xfc).length, 1);
  assert.deepEqual(port.of(0xf2).at(-1).data, [0xf2, 48, 0]);
  assert.equal(port.of(0xfb).length, 1);
});

test("Song Position is the next sixteenth on, and stops at its largest", () => {
  const line = S.timeline(passes(2, 120), WHOLE);
  assert.deepEqual(S.songPosition(line, 0), { sixteenths: 0, pulse: 0 });
  assert.deepEqual(S.songPosition(line, 0.13), { sixteenths: 2, pulse: 12 });
  assert.deepEqual(S.sppBytes(200), [0xf2, 200 & 127, 1]);
  const long = S.timeline([{ start: 0, end: 10000, bpm: 120, base: 4, holds: [] }], WHOLE);
  assert.equal(S.songPosition(long, 9000).sixteenths, 16383);
});

test("a loop held up in the background sends no burst of late pulses: Stop, Song Position, Continue", () => {
  const port = new FakeOutput();
  let now = 0;
  const clock = new S.ClockSender(port, { now: () => now });
  const line = S.timeline(passes(8, 120), WHOLE);
  const handle = { time: 0, rate: 1, paused: false };
  clock.tick(handle, line);
  now = 1000;
  handle.time = 1;
  const before = port.of(0xf8).length;
  clock.tick(handle, line);
  assert.equal(port.of(0xfc).length, 1);
  assert.deepEqual(port.of(0xf2).at(-1).data, [0xf2, 8, 0]);
  const late = port.of(0xf8).slice(before).filter((p) => p.at === now);
  assert.ok(late.length <= 1, `${late.length} pulses at once`);
});

test("a dead port does not stop the clock", () => {
  const clock = new S.ClockSender({ send() { throw new Error("unplugged"); } }, { now: () => 0 });
  assert.doesNotThrow(() => clock.tick({ time: 0, rate: 1, paused: false }, S.timeline(passes(1), WHOLE)));
});

test("an incoming clock gives its Start, Stop, Continue, position and tempo", () => {
  const said = [];
  const follower = new S.ClockFollower({
    start: () => said.push("start"),
    stop: () => said.push("stop"),
    continue: () => said.push("continue"),
    position: (n) => said.push(`at ${n}`),
    tempo: (bpm) => said.push(Math.round(bpm)),
  });
  assert.equal(follower.message([0xfa], 0), true);
  // 90 beats a minute: a pulse every 60000 / 90 / 24 ms.
  for (let k = 0; k <= 24; k++) follower.message([0xf8], k * (60000 / 90 / 24));
  follower.message([0xfc], 0);
  follower.message([0xf2, 0, 1], 0);
  follower.message([0xfb], 0);
  assert.equal(follower.message([0x90, 60, 100], 0), false, "a note is not the clock's");
  assert.deepEqual(said, ["start", 90, "stop", "at 128", "continue"]);
  // The same tempo again is not said again; a new one is.
  for (let k = 25; k <= 30; k++) follower.message([0xf8], k * (60000 / 90 / 24));
  assert.equal(said.filter((x) => x === 90).length, 1);
  let t = 30 * (60000 / 90 / 24);
  for (let k = 0; k < 25; k++) follower.message([0xf8], (t += 60000 / 120 / 24));
  assert.equal(said.at(-1), 120);
});

/** A localStorage of its own. */
function storage() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), kept };
}

test("a control is learnt from the next one moved, and kept in the browser", () => {
  const store = storage();
  const learnt = new S.Learnt(store);
  learnt.learn("play");
  assert.deepEqual(learnt.message([0x80, 36, 0]), { swallowed: true }, "a key let go does not teach");
  const done = learnt.message([0x99, 36, 100]);
  assert.equal(done.learnt, "play");
  assert.equal(S.controlName(done.control), "note C2, channel 10");
  assert.deepEqual(JSON.parse(store.kept.get("eui-score-midi-learn")), { play: { kind: "note", channel: 9, number: 36 } });
  // Read back by the next visit.
  const again = new S.Learnt(store);
  assert.deepEqual(again.message([0x99, 36, 90]), { target: "play", value: 1 });
  assert.deepEqual(again.message([0x89, 36, 0]), { swallowed: true }, "its release does nothing");
  assert.equal(again.message([0x99, 37, 90]), null, "another pad is not learnt");
  assert.equal(again.message([0x98, 36, 90]), null, "nor the same pad on another channel");
});

test("a knob learnt for a button presses it as it goes over half way, once", () => {
  const learnt = new S.Learnt(storage());
  learnt.learn("mute:2");
  learnt.message([0xb0, 20, 10]);
  assert.equal(S.controlName(learnt.get("mute:2")), "CC 20, channel 1");
  assert.deepEqual(learnt.message([0xb0, 20, 127]), { target: "mute:2", value: 1 });
  assert.deepEqual(learnt.message([0xb0, 20, 120]), { swallowed: true });
  assert.deepEqual(learnt.message([0xb0, 20, 0]), { swallowed: true });
  assert.deepEqual(learnt.message([0xb0, 20, 100]), { target: "mute:2", value: 1 });
});

test("a fader learnt for the volume or the speed gives its value", () => {
  const learnt = new S.Learnt(storage());
  learnt.learn("volume");
  learnt.message([0xb1, 7, 50]);
  assert.deepEqual(learnt.message([0xb1, 7, 127]), { target: "volume", value: 1 });
  assert.deepEqual(learnt.message([0xb1, 7, 0]), { target: "volume", value: 0 });
});

test("one control a target, one target a control; cleared one by one or all", () => {
  const store = storage();
  const learnt = new S.Learnt(store);
  learnt.assign("play", { kind: "cc", channel: 0, number: 1 });
  learnt.assign("stop", { kind: "cc", channel: 0, number: 1 });
  assert.equal(learnt.get("play"), null, "the control moved to Stop");
  learnt.assign("stop", { kind: "cc", channel: 0, number: 2 });
  learnt.assign("record", { kind: "note", channel: 0, number: 60 });
  assert.deepEqual(learnt.list().map((x) => x.target), ["stop", "record"]);
  learnt.clear("stop");
  assert.deepEqual(learnt.list().map((x) => x.target), ["record"]);
  learnt.clear();
  assert.deepEqual(learnt.list(), []);
  assert.equal(store.kept.get("eui-score-midi-learn"), "{}");
  // Pitch bend and pressure are not controls: they sound.
  assert.equal(S.controlOf([0xe0, 0, 64]), null);
  assert.equal(S.isExpression([0xe3, 0, 64]), true);
  assert.equal(S.isExpression([0xd0, 40]), true);
  assert.equal(S.isExpression([0xb0, 1, 40]), false);
});

test("a spoilt store learns nothing and breaks nothing", () => {
  const learnt = new S.Learnt({ getItem: () => "{not json", setItem: () => { throw new Error("full"); } });
  assert.deepEqual(learnt.list(), []);
  assert.doesNotThrow(() => learnt.assign("play", { kind: "cc", channel: 0, number: 1 }));
  assert.deepEqual(S.readSettings({ getItem: () => "{not json" }), { clockOut: false, clockIn: false, delay: 0 });
  assert.deepEqual(S.readSettings({ getItem: () => '{"clockOut":true,"delay":"12"}' }), { clockOut: true, clockIn: false, delay: 12 });
});

test("the output's latency: the audio context's in this browser, the one set by hand for a device", () => {
  assert.equal(P.outputDelay({ outputLatency: 0.04, baseLatency: 0.01 }), 0.05);
  // Safari says only baseLatency.
  assert.equal(P.outputDelay({ baseLatency: 0.012 }), 0.012);
  assert.equal(P.outputDelay(null), 0);
  assert.equal(P.outputDelay({ outputLatency: 0.2 }, true, 35), 0.035);
  assert.equal(P.outputDelay({ outputLatency: 0.2 }, true, -10), 0, "never ahead of what was sent");
});

test("a key is recorded when it was struck, not when its message was read", () => {
  // Heard at 2 s, the message read 20 ms after it came: struck at 1.98 s; at double speed, 1.96 s of the piece.
  assert.equal(S.struckAt(2, 1, 20), 1.98);
  assert.equal(S.struckAt(2, 2, 20), 1.96);
  assert.equal(S.struckAt(0.01, 1, 50), 0);
  assert.equal(S.struckAt(2, 1, -5), 2, "a stamp from the future changes nothing");
});

test("the keyboard's messages reach the taps first; bends, pressure and volume go to the MIDI device", async () => {
  const keyboard = { onmidimessage: null };
  const device = new FakeOutput();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { requestMIDIAccess: async () => ({ inputs: new Map([["kb", keyboard]]), outputs: new Map([["dev", device]]) }) },
  });
  await P.midiInputs();
  const keys = [];
  P.listen("kb", (key, held, velocity, stamp) => keys.push([key, velocity, stamp]));
  const seen = [];
  const untap = P.tap((data) => {
    seen.push(data[0]);
    return data[0] === 0xf8 || data[1] === 36;
  });
  keyboard.onmidimessage({ data: [0x90, 36, 100], timeStamp: 5 });
  keyboard.onmidimessage({ data: [0x90, 60, 80], timeStamp: 12.5 });
  keyboard.onmidimessage({ data: [0xf8], timeStamp: 13 });
  assert.deepEqual(keys, [[60, 80, 12.5]], "the key the tap kept writes nothing");
  assert.deepEqual(seen, [0x90, 0x90, 0xf8]);
  untap();
  keyboard.onmidimessage({ data: [0x90, 36, 100], timeStamp: 20 });
  assert.equal(keys.length, 2);

  assert.equal(P.setOutput("dev"), device);
  assert.equal(P.outputPort(), device);
  P.setDeviceDelay(30);
  P.hold(64, true, 0, { channel: 3 });
  P.express([0xe0, 0, 96]);
  P.express([0xd0, 70]);
  assert.deepEqual(device.sent.slice(-3).map((m) => m.data), [[0x93, 64, 100], [0xe3, 0, 96], [0xd3, 70]]);
  P.setVolume(0.5);
  const volume = device.sent.slice(-16).map((m) => m.data);
  assert.deepEqual(volume[0], [0xb0, 7, 64]);
  assert.deepEqual(volume[15], [0xbf, 7, 64]);
  assert.equal(P.setVolume(4), 1);
  P.setOutput(null);
  P.listen(null);
});
