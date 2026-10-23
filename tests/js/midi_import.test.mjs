// MIDI files read as scores (public/eui-score/midi-import.js), checked
// against the real engraver: a file built here byte by byte must come out
// as a score the editor reads, with its tempo, metre, staves, instruments
// and drums; what it leaves out is named; a file that is not MIDI is
// refused with a sentence a person can read.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as I from "../../public/eui-score/midi-import.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

// ---- Writing a MIDI file, byte by byte ----------------------------------------------

const DIVISION = 480;
const varLength = (n) => {
  const out = [n & 127];
  while ((n >>= 7)) out.unshift((n & 127) | 128);
  return out;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s) => [...s].map((c) => c.charCodeAt(0));

/** A track from [tick, ...bytes] events, at absolute ticks, ended. */
function track(events) {
  const body = [];
  let now = 0;
  for (const [tick, ...data] of [...events].sort((a, b) => a[0] - b[0])) {
    body.push(...varLength(tick - now), ...data);
    now = tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...text("MTrk"), ...u32(body.length), ...body];
}

const file = (format, tracks) => new Uint8Array([...text("MThd"), ...u32(6), 0, format, 0, tracks.length, DIVISION >> 8, DIVISION & 255, ...tracks.flat()]);
const name = (s) => [0xff, 0x03, s.length, ...text(s)];
const tempoOf = (bpm) => {
  const us = Math.round(60e6 / bpm);
  return [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
};
const metre = (n, d) => [0xff, 0x58, 4, n, Math.log2(d), 24, 8];
/** A note: on at `at` (quarters), lasting `quarters`, on `channel`. */
const note = (channel, key, at, quarters, velocity = 90) => [
  [at * DIVISION, 0x90 | channel, key, velocity],
  [(at + quarters) * DIVISION - 1, 0x80 | channel, key, 0],
];

/** The editor's score for a LilyPond text, failing with what it could not read. */
function scoreOf(source) {
  const read = M.fromParsed(JSON.parse(score_json(source)));
  assert.ok(read.score, `the editor reads it back (${(read.unsupported ?? []).join(", ")})\n${source}`);
  return read.score;
}

/** Each sounding event of lane `s`: its keys (or drums), in order. */
const heard = (score, s) => score.staves[s].events.filter((ev) => !ev.rest).map((ev) => ev.pitches.map((p) => p.drum ?? M.midiKey(p.d, p.alter)).join("+"));

// ---- The tests ----------------------------------------------------------------------

test("midi import: format 1 — tempo and metre from the tempo track, two tracks as two staves, their instruments, drums", () => {
  const conductor = track([[0, ...name("Little March")], [0, ...tempoOf(90)], [0, ...metre(3, 4)]]);
  const flute = track([[0, ...name("Flute")], [0, 0xc0, 73], ...note(0, 72, 0, 1), ...note(0, 74, 1, 1), ...note(0, 76, 2, 1), ...note(0, 77, 3, 3)]);
  const cello = track([[0, 0xc1, 42], ...note(1, 48, 0, 3), ...note(1, 43, 3, 3)]);
  const drums = track([...note(9, 36, 0, 1), ...note(9, 42, 1, 1), ...note(9, 38, 2, 1), ...note(9, 36, 3, 1), ...note(9, 38, 5, 1)]);
  const { source, score, warnings } = I.fromMidi(file(1, [conductor, flute, cello, drums]), { title: "file-name" });
  assert.deepEqual(warnings, []);
  assert.equal(score.header.title, "Little March");
  assert.equal(score.tempo.bpm, 90);
  assert.deepEqual(score.time, [3, 4]);
  const read = scoreOf(source);
  assert.equal(read.staves.length, 3);
  assert.deepEqual(read.time, [3, 4]);
  assert.equal(read.tempo.bpm, 90);
  assert.equal(M.barsOf(read), 2);
  // The flute: named after its track, its sound the program's.
  assert.equal(read.staves[0].name, "Flute");
  assert.equal(read.staves[0].instrument, "flute");
  assert.deepEqual(heard(read, 0), ["72", "74", "76", "77"]);
  // The cello: program 42, named after the instrument, in the bass clef.
  assert.equal(read.staves[1].name, "Cello");
  assert.equal(read.staves[1].instrument, "cello");
  assert.equal(read.staves[1].clef, "bass");
  assert.deepEqual(heard(read, 1), ["48", "43"]);
  // Channel 10: a drum staff, each key its drum.
  assert.ok(read.staves[2].drums);
  assert.deepEqual(heard(read, 2), ["bd", "hh", "sn", "bd", "sn"]);
});

test("midi import: format 0 — one track, its channels as staves; no tempo means 120; a wide piano part on two staves", () => {
  const events = [
    [0, 0xc0, 0],
    ...note(0, 72, 0, 2), ...note(0, 76, 2, 2),
    ...note(0, 43, 0, 4),
    [0, 0xc1, 40],
    ...note(1, 67, 0, 1), ...note(1, 69, 1, 1), ...note(1, 71, 2, 1), ...note(1, 72, 3, 1),
  ];
  const { source, score, warnings } = I.fromMidi(file(0, [track(events)]), { title: "Duet" });
  assert.deepEqual(warnings, []);
  assert.equal(score.header.title, "Duet");
  assert.equal(score.tempo.bpm, 120);
  assert.deepEqual(score.time, [4, 4]);
  const read = scoreOf(source);
  assert.equal(read.staves.length, 3);
  // The piano, far both sides of middle C: two staves in a brace, named "Piano" among the others.
  assert.deepEqual(read.groups.map((g) => [g.kind, g.first, g.last, g.name]), [["brace", 0, 1, "Piano"]]);
  assert.deepEqual(heard(read, 0), ["72", "76"]);
  assert.equal(read.staves[1].clef, "bass");
  assert.deepEqual(heard(read, 1), ["43"]);
  assert.equal(read.staves[2].instrument, "violin");
  assert.deepEqual(heard(read, 2), ["67", "69", "71", "72"]);
});

test("midi import: notes off the grid are fitted to it, chords kept together, a long note tied over the bar line", () => {
  const events = [
    // A little late, a little short: still a quarter on beat one.
    [10, 0x90, 60, 80], [DIVISION - 30, 0x80, 60, 0],
    // A chord, its notes a few ticks apart.
    [DIVISION, 0x90, 64, 80], [DIVISION + 5, 0x90, 67, 80], [2 * DIVISION, 0x80, 64, 0], [2 * DIVISION, 0x80, 67, 0],
    // From beat four of bar one to beat one of bar two: tied.
    ...note(0, 65, 3, 2),
  ];
  const { source } = I.fromMidi(file(0, [track(events)]), { grid: "eighth" });
  const read = scoreOf(source);
  assert.deepEqual(heard(read, 0), ["60", "64+67", "65", "65"]);
  const sounding = read.staves[0].events.filter((ev) => !ev.rest);
  assert.ok(sounding[2].tie, "the F is tied over the bar line");
  assert.equal(M.ticksOf(sounding[0]), M.WHOLE / 4);
});

test("midi import: a note let go a little after the last bar line adds no bar", () => {
  const events = [[0, 0x90, 60, 80], [4 * DIVISION + 12, 0x80, 60, 0]];
  const read = scoreOf(I.fromMidi(file(0, [track(events)])).source);
  assert.equal(M.barsOf(read), 1);
  assert.deepEqual(heard(read, 0), ["60"]);
});

test("midi import: what the score does not keep is named once each", () => {
  const conductor = track([[0, ...tempoOf(100)], [0, ...metre(4, 4)], [4 * DIVISION, ...tempoOf(140)], [4 * DIVISION, ...metre(3, 4)]]);
  const piano = track([
    [0, 0xb0, 64, 127], [0, 0xe0, 0, 80], [DIVISION, 0xe0, 0, 90],
    ...note(0, 60, 0, 4), ...note(0, 62, 4, 3),
    ...note(9, 81, 0, 1),
    [DIVISION, 0xc0, 0], [2 * DIVISION, 0xc0, 40],
  ]);
  const { warnings } = I.fromMidi(file(1, [conductor, piano]));
  assert.deepEqual(warnings.sort(), [
    "drums this editor does not name, left out",
    "instrument changes in a track, its first instrument kept",
    "metre changes, the first metre kept",
    "pitch bends",
    "tempo changes, the first tempo kept",
    "the sustain pedal",
  ]);
});

test("midi import: more tracks than staves — the first are kept, the rest named", () => {
  const tracks = Array.from({ length: I.MAX_STAVES + 2 }, (_, k) => track([[0, 0xc0 | (k % 8), 40], ...note(k % 8, 60 + k, 0, 4)]));
  const { source, warnings } = I.fromMidi(file(1, tracks));
  assert.deepEqual(warnings, [`2 staves after the first ${I.MAX_STAVES}`]);
  assert.equal(scoreOf(source).staves.length, I.MAX_STAVES);
});

test("midi import: running status and note-ons at velocity 0 read as the notes they are", () => {
  // One status byte, then three notes on and off without it.
  const quarter = varLength(DIVISION);
  const half = varLength(2 * DIVISION);
  const body = [0, 0x90, 60, 90, ...quarter, 60, 0, 0, 62, 90, ...quarter, 62, 0, 0, 64, 90, ...half, 64, 0, 0, 0xff, 0x2f, 0];
  const bytes = new Uint8Array([...text("MThd"), ...u32(6), 0, 0, 0, 1, DIVISION >> 8, DIVISION & 255, ...text("MTrk"), ...u32(body.length), ...body]);
  const read = scoreOf(I.fromMidi(bytes).source);
  assert.deepEqual(heard(read, 0), ["60", "62", "64"]);
  const sounding = read.staves[0].events.filter((ev) => !ev.rest);
  assert.deepEqual(sounding.map((ev) => ev.base), [4, 4, 2]);
});

test("midi import: what is not a MIDI file is refused, with its reason", () => {
  const refused = (bytes, fragment) => assert.throws(() => I.fromMidi(bytes), (error) => error.message.includes(fragment), fragment);
  refused(new TextEncoder().encode("\\relative c' { c4 d e f }"), "This is not a MIDI file that can be read: it does not start as one (MThd)");
  refused(new Uint8Array([]), "it does not start as one");
  refused(new Uint8Array([...text("MThd"), ...u32(6), 0, 1, 0, 1, 1, 224, ...text("MTrk"), ...u32(40), 0, 0x90]), "track 1 is cut short");
  refused(new Uint8Array([...text("MThd"), ...u32(6), 0, 2, 0, 1, 1, 224, ...track([])]), "format 2");
  refused(new Uint8Array([...text("MThd"), ...u32(6), 0, 0, 0, 1, 0xe7, 40, ...track([])]), "SMPTE");
  refused(new Uint8Array([...text("MThd"), ...u32(6), 0, 0, 0, 1, 1, 224, ...text("MTrk"), ...u32(3), 0, 60, 90]), "data where an event should start");
  assert.throws(() => I.fromMidi(file(0, [track([[0, ...tempoOf(80)]])])), /This MIDI file holds no note to write\./);
});

test("midi import: a MIDI file's name", () => {
  assert.ok(I.isMidi("song.mid"));
  assert.ok(I.isMidi("SONG.MIDI"));
  assert.ok(!I.isMidi("song.musicxml"));
  assert.ok(!I.isMidi(null));
});
