// The MIDI as it is heard (score-model.js `playedSource`, which eui-score.js
// `toMidi`, the editor's Save as MIDI and the gallery's buttons go through):
// every repeat played out, its endings in turn, the D.S. taken, at 100 a
// quarter when the source sets no tempo — the same music Play plays.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** A Standard MIDI File's note-ons, in quarters from the start, and its tempo (a quarter's bpm, or null when it sets none). */
function heard(bytes) {
  const division = (bytes[12] << 8) | bytes[13];
  const notes = [];
  let tempo = null;
  let at = 14;
  const number = (q) => {
    let value = 0;
    let byte;
    do {
      byte = bytes[q.at++];
      value = (value << 7) | (byte & 127);
    } while (byte & 128);
    return value;
  };
  while (at < bytes.length) {
    const length = (bytes[at + 4] << 24) | (bytes[at + 5] << 16) | (bytes[at + 6] << 8) | bytes[at + 7];
    const q = { at: at + 8 };
    const end = q.at + length;
    let ticks = 0;
    let running = 0;
    while (q.at < end) {
      ticks += number(q);
      let status = bytes[q.at];
      if (status & 128) q.at++;
      else status = running;
      running = status;
      if (status === 0xff) {
        const type = bytes[q.at++];
        const size = number(q);
        if (type === 0x51) tempo = Math.round(60e6 / ((bytes[q.at] << 16) | (bytes[q.at + 1] << 8) | bytes[q.at + 2]));
        q.at += size;
      } else if (status === 0xf0 || status === 0xf7) {
        q.at += number(q);
      } else {
        const kind = status & 0xf0;
        const key = bytes[q.at++];
        const velocity = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[q.at++];
        if (kind === 0x90 && velocity > 0) notes.push([ticks / division, key]);
      }
    }
    at = end;
  }
  notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { tempo, notes };
}

const played = (source) => heard(midi(M.playedSource(source, score_json), M.DEFAULT_BPM, 4, 0));

test("played midi: a repeat with two endings plays its bars twice, each ending in turn, at 100 a quarter", () => {
  const source = "{ \\time 4/4 \\repeat volta 2 { c'4 d' e' f' } \\alternative { { g'1 } { a'1 } } b'1 \\bar \"|.\" }";
  const { tempo, notes } = played(source);
  assert.equal(tempo, 100);
  assert.deepEqual(
    notes.map(([, key]) => key),
    [60, 62, 64, 65, 67, 60, 62, 64, 65, 69, 71],
  );
  assert.deepEqual(
    notes.map(([quarter]) => quarter),
    [0, 1, 2, 3, 4, 8, 9, 10, 11, 12, 16],
  );
  // As written, the engraver plays the repeat once and both endings in a row.
  assert.deepEqual(
    heard(midi(source, 0, 4, 0)).notes.map(([, key]) => key),
    [60, 62, 64, 65, 67, 69, 71],
  );
});

test("played midi: the source's own tempo wins over the default", () => {
  const { tempo } = played("{ \\tempo 4 = 72 \\repeat volta 2 { c'1 } d'1 }");
  assert.equal(tempo, 72);
});

test("played midi: a D.S. al Fine goes back to the segno and stops at the Fine", () => {
  const score = M.fromParsed(JSON.parse(score_json("{ c'1 | d'1 | e'1 | f'1 \\bar \"|.\" }"))).score;
  M.setMark(score, 1, "segno");
  M.setJump(score, 2, "fine");
  M.setJump(score, 3, "ds-fine");
  const source = M.toLilyPond(score).source;
  assert.deepEqual(
    played(source).notes.map(([, key]) => key),
    [60, 62, 64, 65, 62, 64],
  );
});

test("played midi: a source the model cannot read, or with no repeat, is played as written", () => {
  const plain = "{ c'4 d' e' f' }";
  assert.equal(M.playedSource(plain, score_json), plain);
  const refused = "{ \\repeat volta 2 { c'4 d' e' f' } ";
  assert.equal(M.playedSource(refused, score_json), refused);
});
