// More than fifteen staves without two on one MIDI channel (#389):
// score-model.js `channels` plans them, channels.js rewrites the
// engraver's MIDI to that plan, and the velocities, the curves and the
// mixer still find each staff.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as Ch from "../../public/eui-score/channels.js";
import * as Vel from "../../public/eui-score/velocity.js";
import * as A from "../../public/eui-score/automation.js";
import * as X from "../../public/eui-score/mixer.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const Q = M.WHOLE / 4;
const SOUNDS = ["acoustic grand", "violin", "viola", "cello", "flute", "oboe", "clarinet", "bassoon", "trumpet", "trombone", "french horn", "tuba", "orchestral harp", "marimba", "vibraphone", "celesta", "church organ", "acoustic guitar (nylon)", "electric bass (finger)", "choir aahs"];

/** A score of `sounds.length` pitched staves (the instruments given), a drum kit after them when `drums`; each staff a note of its own, a step above the one before. */
function orchestra(sounds, { drums = true } = {}) {
  const s = M.newScore();
  s.staves[0].instrument = sounds[0];
  for (const sound of sounds.slice(1)) M.addStaff(s, { instrument: sound });
  if (drums) M.addStaff(s, { drums: true, name: "Drums", short: "Dr.", instrument: "", clef: "percussion" });
  sounds.forEach((_, lane) => M.write(s, lane, 0, Q, { rest: false, pitches: [{ d: 7 + lane, alter: 0 }] }));
  if (drums) M.drumHit(s, sounds.length, 0, "bd");
  return s;
}

/** The MIDI as Play has the engraver write it, then on its planned channels. */
const engraved = (score) => midi(M.toLilyPond(score, { unfold: true }).source, M.DEFAULT_BPM, 4, 0);
const planned = (score) => Ch.assignChannels(score, engraved(score));

/** Each track's synthesizer channel, its program, and its notes' keys. */
function tracks(bytes) {
  const smf = F.readSmf(bytes);
  return smf.tracks
    .filter((events) => events.some((e) => e.data[0] >= 0x80 && e.data[0] < 0xf0))
    .map((events) => {
      const port = Ch.portOf(events);
      const channels = new Set(events.filter((e) => e.data[0] >= 0x80 && e.data[0] < 0xf0).map((e) => 16 * port + (e.data[0] & 15)));
      return {
        port,
        channels: [...channels],
        program: events.find((e) => (e.data[0] & 0xf0) === 0xc0)?.data[1],
        keys: events.filter((e) => (e.data[0] & 0xf0) === 0x90 && e.data[2] > 0).map((e) => e.data[1]),
        controls: events.filter((e) => (e.data[0] & 0xf0) === 0xb0).map((e) => [e.data[1], e.data[2]]),
      };
    });
}

test("up to fifteen pitched staves: as eui-score numbers them, the file untouched", () => {
  const s = orchestra(SOUNDS.slice(0, 11), { drums: false });
  assert.deepEqual(M.channels(s).map((c) => c.channel), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
  assert.ok(M.channels(s).every((c) => c.port === 0));
  const bytes = engraved(s);
  assert.equal(Ch.assignChannels(s, bytes), bytes, "the same bytes: nothing to move");
  assert.equal(Ch.assignChannels(null, bytes), bytes, "no score: nothing known");
});

test("fifteen pitched staves after a drum kit: each its own channel, where eui-score put two on the sixteenth", () => {
  const s = M.newScore();
  s.staves[0] = { ...s.staves[0], drums: true, instrument: "", clef: "percussion" };
  for (let k = 0; k < 15; k++) M.addStaff(s, { instrument: SOUNDS[k] });
  M.drumHit(s, 0, 0, "bd");
  for (let k = 1; k <= 15; k++) M.write(s, k, 0, Q, { rest: false, pitches: [{ d: 7 + k, alter: 0 }] });
  const engine = tracks(engraved(s)).map((t) => t.channels[0]);
  assert.equal(engine.filter((c) => c === 15).length, 2, "eui-score: two staves on the sixteenth");
  const plan = M.channels(s);
  assert.equal(plan[0].channel, 9, "the kit keeps the tenth");
  assert.deepEqual(plan.slice(1).map((c) => c.channel), M.PITCHED_CHANNELS, "the fifteen others, one each");
  const out = tracks(planned(s));
  assert.deepEqual(out.map((t) => t.channels[0]), plan.map((c) => c.channel));
  assert.ok(out.every((t) => t.port === 0 && t.channels.length === 1), "one port, a channel a track");
});

test("twenty staves and a kit, all different: a second port, no channel twice, the tenth left to the drums", () => {
  const s = orchestra(SOUNDS);
  const plan = M.channels(s);
  assert.equal(plan.length, 21);
  assert.equal(plan[20].channel, 9, "the drums on the tenth of the first port");
  const pitched = plan.slice(0, 20);
  assert.equal(new Set(pitched.map((c) => c.channel)).size, 20, "twenty channels");
  assert.ok(pitched.every((c) => c.channel % 16 !== 9), "no staff of notes on a tenth channel");
  assert.deepEqual(pitched.map((c) => c.port), [...Array(15).fill(0), ...Array(5).fill(1)]);
  assert.deepEqual(pitched.slice(15).map((c) => c.channel), [16, 17, 18, 19, 20]);
  // The file: a port event at each track's head, each track on its channel, its program kept.
  const before = tracks(engraved(s));
  assert.equal(new Set(before.map((t) => t.channels[0])).size, 16, "eui-score: the last six on one channel");
  const after = tracks(planned(s));
  assert.deepEqual(after.map((t) => t.channels), plan.map((c) => [c.channel]));
  assert.deepEqual(after.map((t) => t.program), before.map((t) => t.program), "each staff its own instrument");
  assert.equal(new Set(after.slice(0, 20).map((t) => t.program)).size, 20, "twenty instruments");
  assert.deepEqual(after.map((t) => t.keys), before.map((t) => t.keys), "and its own notes");
  const smf = F.readSmf(planned(s));
  assert.ok(smf.tracks.every((events) => events[0].data[0] === 0xff && events[0].data[1] === 0x21), "a MIDI Port event first in every track");
  assert.equal(smf.format, 1);
  // The velocities find each staff, on either port.
  const ons = Vel.midiNoteOns(planned(s));
  assert.deepEqual(
    ons.filter((n) => n.key !== 36).map((n) => n.channel),
    pitched.map((c) => c.channel),
  );
});

test("twenty staves of ten instruments: the same instrument and settings share a channel, no second port", () => {
  const sounds = SOUNDS.slice(0, 10).flatMap((x) => [x, x]);
  const s = orchestra(sounds);
  const plan = M.channels(s);
  const channelOf = (lane) => plan.find((c) => c.lane === lane).channel;
  for (let k = 0; k < 20; k += 2) assert.equal(channelOf(k), channelOf(k + 1), `${sounds[k]}: one channel`);
  assert.equal(new Set(plan.slice(0, 20).map((c) => c.channel)).size, 10);
  assert.ok(plan.every((c) => c.port === 0));
  // A staff whose mixer differs, or with curves of its own, does not share.
  X.setMix(s, 3, { volume: -6 });
  s.meta = { ...s.meta, cc: { 5: { 1: [[0, 64]] } } };
  const again = M.channels(s);
  const of = (lane) => again.find((c) => c.lane === lane).channel;
  assert.notEqual(of(2), of(3), "a fader moved: its own channel");
  assert.notEqual(of(4), of(5), "a curve: its own channel");
  assert.equal(of(0), of(1), "the others still share");
  // In the file, the two violins' tracks both play on that one channel, each with the violin.
  const out = tracks(Ch.assignChannels(s, engraved(s)));
  assert.deepEqual(out[0].channels, out[1].channels);
  assert.equal(out[0].program, out[1].program);
});

test("the padding staff of a recording takes a channel of its own, after the others, which keep theirs", () => {
  const s = orchestra(SOUNDS);
  const padded = M.padded(s);
  const plan = M.channels(padded);
  assert.deepEqual(plan.slice(0, 21), M.channels(s), "the score's staves keep their channels");
  const pad = plan[21];
  assert.ok(!M.channels(s).some((c) => c.channel === pad.channel), "the padding staff's is free");
  assert.notEqual(pad.channel % 16, 9);
  const small = orchestra(SOUNDS.slice(0, 14), { drums: false });
  const plan15 = M.channels(M.padded(small));
  assert.equal(new Set(plan15.map((c) => c.channel)).size, 15, "fourteen and the pad: fifteen channels");
});

test("the curves and the mixer's volume and pan go to the staff's own track, on a second port too", () => {
  const s = orchestra(SOUNDS);
  s.meta = { ...s.meta, cc: { 18: { 1: [[0, 100]] } } };
  X.setMix(s, 17, { volume: -12, pan: -1 });
  const plan = M.channels(s);
  const bytes = planned(s);
  const out = A.applyAutomation(s, bytes, { mix: X.mixOf(s), volumeMin: X.VOLUME_MIN });
  const t = tracks(out);
  assert.equal(plan[18].port, 1);
  assert.ok(t[18].controls.some(([cc, v]) => cc === 1 && v === 100), "the modulation curve in staff 19's track");
  assert.ok(!t[3].controls.some(([cc]) => cc === 1), "not in the track on the same channel of the first port");
  assert.ok(t[17].controls.some(([cc, v]) => cc === 7 && v === A.volumeCc(-12)), "staff 18's fader");
  assert.ok(t[17].controls.some(([cc, v]) => cc === 10 && v === 0), "its pan, hard left");
  assert.ok(t[2].controls.some(([cc, v]) => cc === 10 && v === 64), "the staff on its channel of the first port, centred");
  // Only the lanes asked for, on Play.
  const some = tracks(A.applyAutomation(s, bytes, { mix: X.mixOf(s), mixLanes: [17], volumeMin: X.VOLUME_MIN }));
  assert.ok(some[17].controls.some(([cc]) => cc === 7));
  assert.ok(!some[0].controls.some(([cc]) => cc === 7), "not the others");
  assert.deepEqual(A.eventBytes(17, "1", 5), [0xb1, 1, 5], "a second port's channel written as its channel in the port");
  assert.deepEqual(A.eventBytes(17, "bend", 0), [0xe1, 0, 64]);
});

test("a velocity set on a staff of the second port changes its note only", () => {
  const s = orchestra(SOUNDS);
  const id = Vel.noteId(19, 0, M.midiKey(26, 0));
  Vel.setVelocities(s, { [id]: 17 });
  const ons = Vel.midiNoteOns(Vel.applyVelocities(s, planned(s)));
  const changed = ons.filter((n) => n.velocity === 17);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].channel, M.channels(s)[19].channel);
  assert.equal(changed[0].key, M.midiKey(26, 0));
});

test("the mixer: a strip two staves go through is theirs when alike, flat otherwise, their volume then in the file", () => {
  const channels = [
    { lane: 0, channel: 0 },
    { lane: 1, channel: 16 },
    { lane: 2, channel: 1 },
    { lane: 3, channel: 17 },
  ];
  const score = { meta: {} };
  X.setMix(score, 0, { volume: -6 });
  X.setMix(score, 1, { volume: -6 });
  X.setMix(score, 2, { volume: -3 });
  const mix = X.mixOf(score);
  const strips = X.channelSettings(mix, channels);
  assert.equal(strips[0].volume, -6, "strip 1: both at -6 dB, theirs");
  assert.equal(strips[1].volume, 0, "strip 2: -3 dB and 0 dB, flat");
  assert.equal(strips[1].gain, 1);
  assert.deepEqual(X.fileMixLanes(mix, channels), [2, 3]);
  assert.deepEqual(X.fileMixLanes(mix, channels.slice(0, 1)), [], "one staff a strip: none");
  assert.deepEqual(X.fileMixLanes(mix, [{ lane: 0, channel: -1 }]), []);
});
