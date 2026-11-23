// Writing in written pitch (#1023): with View ▸ Written pitch on, the note
// typed, clicked or played is the one the player reads, stored as the one it
// sounds — a B♭ clarinet's written D is a C, a horn in F's written G a C, an
// alto saxophone's written A a C. The keys and the accidentals are the
// written ones; everything else is left as it was.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const open = (src) => M.fromParsed(JSON.parse(score_json(src)), src).score;
const names = (score, lane = 0) => score.staves[lane].events.filter((ev) => !ev.rest).map((ev) => ev.pitches.map((p) => M.pitchName(p.d, p.alter)).join("+"));
const q = M.notated(4);

const staff = (name, sound, music = "r1 | r1") => `\\new Staff \\with { instrumentName = "${name}" midiInstrument = "${sound}" } { ${music} }`;

test("a letter typed at written pitch: a B♭ clarinet's D is a C, a horn's G a C, an alto sax's A a C", () => {
  const score = open(`<< ${staff("Clarinet in B♭", "clarinet")} ${staff("Horn in F", "french horn")} ${staff("Alto sax", "alto sax")} ${staff("Flute", "flute")} >>`);
  const letterAt = (lane, step, near) =>
    M.asWritten(score, (s) => {
      M.write(s, lane, 0, q, { rest: false, pitches: [M.nearestPitch(step, near, M.keyOf(s, lane, 0))] });
    });
  // Written D5 on the clarinet, G4 on the horn, A4 on the saxophone, C5 on the flute.
  letterAt(0, 1, 14);
  letterAt(1, 4, 11);
  letterAt(2, 5, 12);
  letterAt(3, 0, 14);
  assert.deepEqual(names(score, 0), ["C5"]);
  assert.deepEqual(names(score, 1), ["C4"]);
  assert.deepEqual(names(score, 2), ["C4"]);
  assert.deepEqual(names(score, 3), ["C5"]);
  // Shown at written pitch, they are what was typed.
  let shown = null;
  M.asWritten(score, (s) => (shown = [0, 1, 2, 3].map((lane) => names(s, lane)[0])));
  assert.deepEqual(shown, ["D5", "G4", "A4", "C5"]);
});

test("the written key spells what is typed: F major for the score is G major for the clarinet", () => {
  const score = open(`${staff("Clarinet in B♭", "clarinet", "\\key f \\major r1 | r1")}`);
  assert.equal(M.shownKeyOf(score, 0, 0, true), 1);
  assert.equal(M.shownKeyOf(score, 0, 0, false), -1);
  // The letter F is F♯ in written G major: the E the score's F major holds.
  M.asWritten(score, (s) => {
    assert.equal(M.keyOf(s, 0, 0), 1, "inside, the key is the written one");
    M.write(s, 0, 0, q, { rest: false, pitches: [M.nearestPitch(3, 10, M.keyOf(s, 0, 0))] });
  });
  assert.deepEqual(names(score), ["E4"]);
  // The key is given back as it was written in the text.
  assert.equal(score.staves[0].key, undefined);
  assert.equal(score.key, -1);
});

test("a key played on a MIDI keyboard is a written key: written E4 on an alto sax sounds G3", () => {
  const score = open(staff("Alto sax", "alto sax"));
  M.asWritten(score, (s) => {
    M.write(s, 0, 0, q, { rest: false, pitches: [M.pitchOfKey(64, M.keyOf(s, 0, 0))] });
  });
  assert.deepEqual(names(score), ["G3"]);
});

test("an accidental set at written pitch: written F♯ made natural on a clarinet sounds E♭", () => {
  const score = open(staff("Clarinet in B♭", "clarinet", "e'4 r2. | r1"));
  M.asWritten(score, (s) => M.setAlter(s, 0, 0, 0));
  assert.deepEqual(names(score), ["E♭4"]);
  // At concert pitch the same tool makes it E natural.
  M.setAlter(score, 0, 0, 0);
  assert.deepEqual(names(score), ["E4"]);
});

test("a staff's key set at written pitch: D major for a B♭ clarinet is the score's C", () => {
  const score = open(`<< ${staff("Clarinet in B♭", "clarinet", "c'1 | r1")} ${staff("Flute", "flute", "c''1 | r1")} >>`);
  M.asWritten(score, (s) => M.setStaffKey(s, 0, 4));
  // Written E major on the clarinet: D major as it sounds, its own key beside the flute's C.
  assert.equal(score.staves[0].key, 2);
  assert.deepEqual(names(score, 0), ["C4"], "the notes stay where they sound");
  M.asWritten(score, (s) => M.setStaffKey(s, 0, 2));
  assert.equal(score.staves[0].key, undefined, "written D major is the score's own key");
});

test("what nothing touched comes back as it was, and a refusal leaves the score as it sounds", () => {
  const src = `<< ${staff("Horn in F", "french horn", "\\key e \\major gis'4 a' b' cis'' | dis''1")} ${staff("Violin", "violin", "\\key e \\major e''1 | e''1")} >>`;
  const score = open(src);
  const before = JSON.stringify(score);
  M.asWritten(score, () => {});
  assert.equal(JSON.stringify(score), before);
  assert.throws(() => M.asWritten(score, (s) => {
    s.staves[0].events[0].pitches = [{ d: 0, alter: 0 }];
    throw new Error("refused");
  }), /refused/);
  // What the refused tool did is the editor's to undo (it restores its snapshot); the shift itself is undone.
  assert.equal(score.staves[1].events[0].pitches[0].d, 16);
  assert.equal(score.staves[0].key, undefined);
});

test("a staff written as it sounds is not moved; a drum staff neither", () => {
  const score = open(`<< ${staff("Flute", "flute", "c''1 | r1")} \\new DrumStaff \\drummode { sn4 sn sn sn | sn1 } >>`);
  const before = JSON.stringify(score);
  let seen = null;
  M.asWritten(score, (s) => (seen = names(s, 0)));
  assert.deepEqual(seen, ["C5"]);
  assert.equal(JSON.stringify(score), before);
  assert.equal(M.writtenShiftAt(score, 1, 0), null);
});
