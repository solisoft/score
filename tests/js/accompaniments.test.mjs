// The library of accompaniments (public/eui-score/accompaniments.js, #441):
// every style written for the guitar, the piano, the bass and the drums
// from a song's chord symbols, on staves it adds, engraved by the real
// engraver, played, and read back as it was written.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as A from "../../public/eui-score/accompaniments.js";
import * as V from "../../public/eui-score/voicings.js";
import * as D from "../../public/eui-score/drums.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
const again = (score) => read(M.toLilyPond(score).source);
const mod12 = (n) => ((n % 12) + 12) % 12;

/** A melody of four bars in `time`, a chord symbol a bar. */
function song(time) {
  const bar = { "4/4": "1", "3/4": "2.", "6/8": "2." }[time];
  return read(String.raw`\header { title = "Song" }
\new Staff \with { instrumentName = "Voice" } { \time ${time} e''${bar}^"C" | a'${bar}^"Am" | f'${bar}^"F" | g'${bar}^"G7" }`);
}

function engraves(score, what) {
  const { source } = M.toLilyPond(score);
  try {
    JSON.parse(editor_view(source, 1200, 7, -1, -1));
  } catch (error) {
    throw new Error(`${what}: ${error.message ?? error}\n${source}`);
  }
  midi(M.toLilyPond(score, { unfold: true }).source, 100, 4, 0);
  return source;
}

const named = (score, name) => M.staffLanes(score).find((s) => score.staves[s].name === name);
const pitched = (score, s) => score.staves[s].events.filter((ev) => !ev.rest);

test("every style writes the four instruments on staves of their own, engraved and read back", () => {
  for (const style of A.STYLES) {
    const score = song(style.time);
    const done = A.arrange(score, style.id);
    assert.deepEqual(done.added, ["Guitar", "Piano", "Bass", "Drums"], style.id);
    assert.equal(done.chords, 4);
    engraves(score, style.id);
    const back = again(score);
    assert.equal(M.staffLanes(back).length, 6, `${style.id}: the voice, the guitar, two piano staves, the bass, the drums`);
    assert.deepEqual(back.staves[0].events.map((ev) => ev.chord), ["C", "Am", "F", "G7"], `${style.id}: the melody and its chords as they were`);
    for (const name of ["Guitar", "Bass"]) assert.ok(pitched(back, named(back, name)).length > 0, `${style.id}: the ${name} plays`);
    const drums = named(back, "Drums");
    assert.ok(back.staves[drums].drums && pitched(back, drums).every((ev) => ev.pitches.every((p) => p.drum)), `${style.id}: drums only on the drum staff`);
    const piano = back.groups.find((g) => g.name === "Piano");
    assert.ok(piano && piano.kind === "brace", `${style.id}: the piano's two staves in a brace`);
  }
});

test("each instrument plays the chord sounding: the guitar its notes, the bass in its range", () => {
  const score = song("4/4");
  A.arrange(score, "folk");
  const guitar = named(score, "Guitar");
  const at = M.starts(score.staves[guitar]);
  score.staves[guitar].events.forEach((ev, i) => {
    if (ev.rest) return;
    const chord = V.chordAt(score, at[i]);
    const tones = new Set([...V.chordVoicing(chord).pitches, V.chordVoicing(chord).bass].map((p) => mod12(M.midiKey(p.d, p.alter))));
    assert.ok(ev.pitches.every((p) => tones.has(mod12(M.midiKey(p.d, p.alter)))), `the guitar plays ${chord}'s notes`);
  });
  const bass = named(score, "Bass");
  assert.ok(pitched(score, bass).every((ev) => ev.pitches.every((p) => M.midiKey(p.d, p.alter) >= V.BASS_LOW && M.midiKey(p.d, p.alter) <= V.BASS_HIGH)));
  assert.equal(score.staves[guitar].events.filter((ev) => ev.fret).length, 4, "a diagram over each chord");
});

test("written again in another style, on the same staves; a style in another metre plays a note a beat", () => {
  const score = song("4/4");
  A.arrange(score, "pop");
  A.arrange(score, "rock", { parts: ["guitar", "bass"] });
  assert.equal(M.staffLanes(score).length, 6, "no staff twice");
  const waltz = song("4/4");
  A.arrange(waltz, "waltz", { parts: ["bass"] });
  const bass = named(waltz, "Bass");
  assert.equal(pitched(waltz, bass).length, 4, "4/4 bars under a 3/4 style: the bass on each beat… held: one note a bar here");
  engraves(waltz, "a 3/4 style in 4/4");
});

test("the selected bars only; swing set by a swing style; what is refused", () => {
  const score = song("4/4");
  A.arrange(score, "swing", { a: 1, b: 2, parts: ["drums"] });
  const drums = named(score, "Drums");
  const at = M.starts(score.staves[drums]);
  const struck = score.staves[drums].events.map((ev, i) => (ev.rest ? null : M.barAt(score, at[i]))).filter((b) => b != null);
  assert.deepEqual([...new Set(struck)], [1, 2]);
  assert.deepEqual(score.meta.swing, { amount: 62, unit: 8 });
  assert.throws(() => A.arrange(score, "polka"), /no style called polka/);
  assert.throws(() => A.arrange(read(String.raw`{ c'1 | d'1 }`), "pop"), /No chord symbols there/);
  assert.throws(() => A.arrange(song("4/4"), "pop", { parts: [] }), /Choose an instrument/);
  assert.throws(() => A.arrange(song("4/4"), "pop", { a: 3, b: 9 }), /no such bars/);
});

test("a pattern line reads as notes held to the next one; drum lines as strokes", () => {
  assert.deepEqual(A.notesOf("D---D-U.."), [{ at: 0, len: 4, symbol: "D" }, { at: 4, len: 2, symbol: "D" }, { at: 6, len: 1, symbol: "U" }]);
  assert.deepEqual(A.hitsOf({ hh: "x-x-", bd: "x---" }), [{ at: 0, len: 2, drums: ["hh", "bd"] }, { at: 2, len: 2, drums: ["hh"] }]);
});

test("the drums play the style's groove, with its break at the end of the four bars, unless told not to", () => {
  const strokes = (score, b) => {
    const s = named(score, "Drums");
    const at = M.starts(score.staves[s]);
    return score.staves[s].events.flatMap((ev, i) => (ev.rest || M.barAt(score, at[i]) !== b ? [] : [`${at[i] - M.barStart(score, b)}:${ev.pitches.map((p) => p.drum).sort().join("+")}`]));
  };
  const score = song("4/4");
  A.arrange(score, "rock", { parts: ["drums"] });
  assert.deepEqual(strokes(score, 1), strokes(score, 0), "the basic bar again");
  assert.notDeepEqual(strokes(score, 3), strokes(score, 0), "the break in bar 4");
  const plain = song("4/4");
  A.arrange(plain, "rock", { parts: ["drums"], breaks: false });
  assert.deepEqual(strokes(plain, 3), strokes(plain, 0));
  for (const style of A.STYLES) assert.equal(D.grooveOf(style.groove)?.time, style.time, `${style.id}: a groove in its metre`);
});
