// The guitar riffs (public/eui-score/riffs.js, #458): every riff over the
// chords of a song, written by the accompaniment in place of the strumming,
// engraved by the real engraver, played, read back; its notes the chord's,
// low on the neck; each guitar note's force kept.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as A from "../../public/eui-score/accompaniments.js";
import * as R from "../../public/eui-score/riffs.js";
import * as Vel from "../../public/eui-score/velocity.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
const BAR = { "4/4": "1", "3/4": "2.", "6/8": "2.", "12/8": "1." };
// A style in the riff's metre; none is in 12/8, where the riff alone fits the bars.
const STYLE = { "4/4": "rock", "3/4": "waltz", "6/8": "six-eight", "12/8": "shuffle" };
const key = (p) => M.midiKey(p.d, p.alter);
const mod12 = (n) => ((n % 12) + 12) % 12;

function song(time) {
  const bar = BAR[time];
  return read(String.raw`\new Staff \with { instrumentName = "Voice" } { \time ${time} e''${bar}^"E" | a'${bar}^"A7" | b'${bar}^"Bm" | e''${bar}^"E" }`);
}

test("the riffs: lines of the letters the riffs read, one length a riff, in a metre the accompaniment knows", () => {
  assert.ok(R.RIFFS.length >= 15);
  const ids = new Set();
  for (const riff of R.RIFFS) {
    assert.ok(!ids.has(riff.id), riff.id);
    ids.add(riff.id);
    assert.ok(BAR[riff.time], `${riff.id}: ${riff.time}`);
    for (const line of riff.bars) {
      assert.match(line, /^[RFTQSZOPYW.-]+$/, riff.id);
      assert.equal(line.length, R.stepsOf(riff), `${riff.id}: every bar as long`);
    }
  }
  assert.equal(R.riffOf("no-such"), null);
});

test("a riff's notes are the chord's, its root low on the neck, spelt as the chord spells them", () => {
  assert.deepEqual(R.riffNotes("E", "P").map(key), [40, 47]);
  assert.deepEqual(R.riffNotes("A7", "Y").map(key), [45, 54]);
  assert.deepEqual(R.riffNotes("Am", "T").map(key), [48], "a minor chord's third");
  assert.deepEqual(R.riffNotes("A", "T").map(key), [49], "a major one's");
  assert.deepEqual(R.riffNotes("Bb", "R"), [{ d: -1, alter: -1 }], "B flat, not A sharp");
  for (const chord of ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]) {
    const root = key(R.riffNotes(chord, "R")[0]);
    assert.ok(root >= 40 && root <= 51, `${chord}: ${root} low on the neck`);
  }
  assert.deepEqual(R.riffNotes("not a chord", "R"), []);
  assert.deepEqual(R.riffNotes("C", "-"), []);
});

test("every riff played by the accompaniment over a song: engraved, played, read back, its notes the chords'", () => {
  for (const riff of R.RIFFS) {
    const score = song(riff.time);
    A.arrange(score, STYLE[riff.time], { parts: ["guitar"], riff: riff.id });
    const { source } = M.toLilyPond(score);
    try {
      JSON.parse(editor_view(source, 1200, 7, -1, -1));
    } catch (error) {
      throw new Error(`${riff.id}: ${error.message ?? error}\n${source}`);
    }
    midi(M.toLilyPond(score, { unfold: true }).source, 100, 4, 0);
    const back = read(source);
    const guitar = M.staffLanes(back).find((s) => back.staves[s].name === "Guitar");
    const notes = back.staves[guitar].events.filter((ev) => !ev.rest);
    assert.ok(notes.length > 0, `${riff.id}: the guitar plays`);
    assert.ok(notes.every((ev) => ev.pitches.every((p) => key(p) >= 40 && key(p) <= 64)), `${riff.id}: low on the neck`);
  }
});

test("a riff in its bars only; a guitar note's force by where it falls; a riff that does not exist refused", () => {
  const score = song("4/4");
  A.arrange(score, "rock", { parts: ["guitar"], riff: "boogie" });
  const guitar = M.staffLanes(score).find((s) => score.staves[s].name === "Guitar");
  const first = score.staves[guitar].events.find((ev) => !ev.rest);
  assert.deepEqual(first.pitches.map(key), [40, 47], "the boogie opens on E's power chord");
  const ids = new Set(Vel.velocityNotes(score).map((n) => n.id));
  const forces = Object.entries(score.meta.velocity ?? {});
  assert.ok(forces.length > 20 && forces.every(([id]) => ids.has(id)), "each note its force, on a note of the score");
  assert.ok(score.meta.humanize, "and played with a little unevenness");
  assert.ok(A.guitarForce("D", "down", 0, 6) > A.guitarForce("U", "half", 0, 4), "a downstroke over an upstroke");
  assert.ok(A.guitarForce("D", "beat", 0, 6) > A.guitarForce("D", "beat", 5, 6), "its low strings first");
  assert.ok(A.guitarForce("U", "half", 3, 4) > A.guitarForce("U", "half", 0, 4), "an upstroke's high strings first");
  assert.ok(A.guitarForce("R", "down", 0, 1, true) > A.guitarForce("R", "sub", 0, 1, true));
  assert.throws(() => A.arrange(song("4/4"), "rock", { riff: "no-such" }), /no riff called no-such/);
});

test("the piano patterns (#459): every one over a song, engraved, played, read back, its left hand on the chords", () => {
  assert.ok(R.PIANO_RIFFS.length >= 12);
  for (const riff of R.PIANO_RIFFS) {
    for (const bar of riff.bars) {
      assert.equal(bar.lh.length, bar.rh.length, `${riff.id}: both hands as long`);
      assert.match(bar.lh, /^[RFTQSZOPYWL.-]+$/, riff.id);
      assert.match(bar.rh, /^[CT1-6.-]+$/, riff.id);
    }
    const score = song(riff.time);
    A.arrange(score, STYLE[riff.time], { parts: ["piano"], pianoRiff: riff.id });
    const { source } = M.toLilyPond(score);
    try {
      JSON.parse(editor_view(source, 1200, 7, -1, -1));
    } catch (error) {
      throw new Error(`${riff.id}: ${error.message ?? error}\n${source}`);
    }
    midi(M.toLilyPond(score, { unfold: true }).source, 100, 4, 0);
    const back = read(source);
    const brace = back.groups.find((g) => g.name === "Piano");
    const lower = M.staffLanes(back)[brace.last];
    const at = M.starts(back.staves[lower]);
    back.staves[lower].events.forEach((ev, i) => {
      if (ev.rest) return;
      // Over the chord's root: its notes, and the riff letters' fourth, sixth and flat seventh.
      const chord = ["E", "A7", "Bm", "E"][M.barAt(back, at[i])];
      const root = { E: 4, A7: 9, Bm: 11 }[chord];
      const allowed = new Set([0, 3, 4, 5, 7, 9, 10].map((n) => mod12(root + n)));
      for (const p of ev.pitches) assert.ok(allowed.has(mod12(key(p))), `${riff.id}: ${M.midiKey(p.d, p.alter)} over ${chord}`);
    });
    const ids = new Set(Vel.velocityNotes(score).map((n) => n.id));
    const forces = Object.keys(score.meta.velocity ?? {});
    assert.ok(forces.length > 0 && forces.every((id) => ids.has(id)), `${riff.id}: each note its force`);
  }
});

test("a pianist's force: the bass marked, the chord lighter off the beat, its top note sung; an unknown pattern refused", () => {
  assert.ok(A.pianoForce("lh", "R", "down") > A.pianoForce("lh", "R", "sub"));
  assert.ok(A.pianoForce("rh", "C", "beat", 0, 4) > A.pianoForce("rh", "C", "half", 0, 4));
  assert.ok(A.pianoForce("rh", "C", "beat", 3, 4) > A.pianoForce("rh", "C", "beat", 1, 4), "the top note over the inner ones");
  const score = song("4/4");
  A.arrange(score, "rock", { parts: ["piano"], pianoRiff: "boogie-woogie" });
  assert.deepEqual(score.meta.swing, { amount: 67, unit: 8 }, "the boogie-woogie swings");
  assert.throws(() => A.arrange(song("4/4"), "rock", { pianoRiff: "no-such" }), /no piano pattern called no-such/);
});
