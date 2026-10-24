// How the score is played over what is written (#379): the meta line,
// rit. and accel. played (the playhead, the metronome, the MIDI clock and
// the MIDI file all gliding together), swing and humanize put into the MIDI,
// quantize and written swing on the model.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json, editor_view } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as S from "../../public/eui-score/midi-sync.js";
import * as Vel from "../../public/eui-score/velocity.js";
import { onsetSeconds } from "./midi_onsets.mjs";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (src) => {
  const result = M.fromParsed(JSON.parse(score_json(src)));
  assert.ok(result.score, `reads: ${result.unsupported}`);
  result.score.meta = M.readMeta(src);
  return result.score;
};
/** The MIDI Play plays: written from the score with its repeats out, then felt. */
const heard = (score, feel = {}) => {
  const passes = M.playback(score);
  const bytes = midi(M.toLilyPond(score, { unfold: true }).source, M.DEFAULT_BPM, 4, 0);
  return { passes, bytes, felt: F.feel(bytes, { score, passes, ...feel }) };
};
/** When the model says each note of lane 0 is played, first pass. */
const modelOnsets = (score, passes) => {
  const at = M.starts(score.staves[0]);
  return score.staves[0].events.flatMap((ev, i) => (ev.rest ? [] : M.playedAt(score, passes, at[i])));
};
const close = (actual, expected, eps = 0.002, what = "") => {
  assert.equal(actual.length, expected.length, `${what} count`);
  actual.forEach((x, k) => assert.ok(Math.abs(x - expected[k]) < eps, `${what} #${k}: ${x} vs ${expected[k]}`));
};
/** Every note-on of a MIDI file: { tick, key, velocity } and the note-offs' ticks by key. */
function notesOf(bytes) {
  const smf = F.readSmf(bytes);
  const on = [];
  const off = [];
  for (const events of smf.tracks) {
    for (const ev of events) {
      const kind = ev.data[0] & 0xf0;
      if (kind === 0x90 && ev.data[2] > 0) on.push({ tick: ev.tick, key: ev.data[1], velocity: ev.data[2] });
      else if (kind === 0x80 || kind === 0x90) off.push({ tick: ev.tick, key: ev.data[1] });
    }
  }
  return { on, off, division: smf.division };
}

// ---- The meta line --------------------------------------------------------------------

test("meta: read, merged key by key, a null takes a key away, always the last line", () => {
  const src = "{ c'1 }\n";
  assert.deepEqual(M.readMeta(src), {});
  const one = M.writeMeta(src, { swing: { amount: 60, unit: 8 } });
  assert.equal(one, '{ c\'1 }\n%% eui-score {"swing":{"amount":60,"unit":8}}\n');
  const two = M.writeMeta(one, { mixer: { gain: 1 } });
  assert.deepEqual(M.readMeta(two), { swing: { amount: 60, unit: 8 }, mixer: { gain: 1 } });
  assert.equal(two.match(/eui-score/g).length, 1, "one line, not two");
  assert.ok(two.trimEnd().split("\n").at(-1).startsWith("%% eui-score "), "last");
  assert.deepEqual(M.readMeta(M.writeMeta(two, { swing: null })), { mixer: { gain: 1 } });
  assert.equal(M.writeMeta(M.writeMeta(two, { swing: null }), { mixer: null }), src, "nothing left: the line goes");
  // A line that does not read is no meta, and is replaced.
  assert.deepEqual(M.readMeta("{ c'1 }\n%% eui-score {nope\n"), {});
  assert.deepEqual(M.readMeta('%% eui-score ["a"]\n'), {});
});

test("meta: the engraver passes over the line; the model writes it back, not into the MIDI's source", () => {
  const src = M.writeMeta("{ \\time 4/4 c'4 d' e' f' | g'1 }\n", { swing: { amount: 66, unit: 8 }, velocity: { "0:0:60": 100 } });
  assert.doesNotThrow(() => editor_view(src, 900, 7, -1, -1));
  const score = read(src);
  // An edit elsewhere: the first rewrite keeps the line, and the other agents' keys.
  M.write(score, 0, M.barStart(score, 1), M.notated(4), { rest: false, pitches: [{ d: 12, alter: 0 }] });
  const { source } = M.toLilyPond(score);
  assert.deepEqual(M.readMeta(source), { swing: { amount: 66, unit: 8 }, velocity: { "0:0:60": 100 } });
  assert.doesNotMatch(M.toLilyPond(score, { unfold: true }).source, /eui-score/);
});

// ---- Tempo ramps ----------------------------------------------------------------------

test("ramps: the words that glide, and those that do not", () => {
  for (const words of ["rit.", "poco rit.", "ritardando", "rall.", "molto rallentando", "allarg."]) assert.equal(M.rampOf(words), "slower", words);
  for (const words of ["accel.", "accelerando", "string."]) assert.equal(M.rampOf(words), "faster", words);
  for (const words of ["a tempo", "Tempo I", "riten.", "Allegro", "", null]) assert.equal(M.rampOf(words), null, String(words));
});

test("ramps: \\tempo \"rit.\" glides to the next tempo given, the bars' times, the playhead and the MIDI together", () => {
  const score = read("{ \\tempo 4 = 120 c'4 c' c' c' | \\tempo \"rit.\" d'4 d' d' d' | d'4 d' d' d' | \\tempo 4 = 60 e'4 e' e' e' }");
  assert.deepEqual(M.tempoRamps(score), [{ t0: M.WHOLE, t1: 3 * M.WHOLE, q0: 120, q1: 60 }]);
  const { passes, bytes, felt } = heard(score);
  assert.equal(passes[0].end, 2, "bar 1 at 120");
  assert.ok(!passes[0].curve && passes[1].curve && passes[2].curve && !passes[3].curve);
  assert.equal(passes[3].end - passes[3].start, 4, "bar 4 at 60");
  // Between 2 s (all at 120) and 4 s (all at 60) a bar, each beat longer than the last.
  const gliding = modelOnsets(score, passes).slice(4, 13);
  const gaps = gliding.slice(1).map((x, k) => x - gliding[k]);
  gaps.forEach((gap, k) => {
    assert.ok(gap > 0.5 && gap < 1, `beat ${k} between the two speeds: ${gap}`);
    if (k) assert.ok(gap > gaps[k - 1], "slowing all the way");
  });
  // The ramp's time: ∫ dx / q, the speed even in the score's time.
  close([passes[3].start - passes[1].start], [8 * 60 * Math.log(2) / 60], 1e-9, "two bars of rit.");
  // The MIDI file plays its notes when the model says they are played.
  close(onsetSeconds(felt), modelOnsets(score, passes), 0.002, "midi");
  assert.notDeepEqual(onsetSeconds(felt), onsetSeconds(bytes), "the engraver's own MIDI does not glide");
  // The playhead: back from seconds to the score's time.
  const starts = M.starts(score.staves[0]);
  for (const i of [5, 7, 9]) {
    const sec = M.playedAt(score, passes, starts[i])[0];
    assert.ok(Math.abs(M.tickAtPlayed(score, passes, sec + 1e-9) - starts[i]) < 2, `note ${i}`);
  }
});

test("ramps: words over a note, a spanner, a target given, a tempo again", () => {
  // accel. over a note, nothing after it: a quarter faster by the end, and held.
  const accel = read("{ \\tempo 4 = 80 c'4 c' c'^\\markup \"accel.\" c' | c'1 | c'1 }");
  const [glide] = M.tempoRamps(accel);
  assert.deepEqual(glide, { t0: M.notated(2), t1: 3 * M.WHOLE, q0: 80, q1: 100 });
  // A spanner's rit.: to the note that stops it, then held until "a tempo".
  const span = read("{ \\tempo 4 = 100 \\override TextSpanner.bound-details.left.text = \"rit.\" c'2\\startTextSpan c' | c'1\\stopTextSpan | c'1 | \\tempo \"a tempo\" c'1 }");
  assert.deepEqual(M.tempoRamps(span), [
    { t0: 0, t1: M.WHOLE, q0: 100, q1: 75 },
    { t0: M.WHOLE, t1: 3 * M.WHOLE, q0: 75, q1: 75 },
  ]);
  const passes = M.playback(span);
  close([passes[1].end - passes[1].start, passes[3].end - passes[3].start], [4 * 0.8, 2.4], 1e-9, "held at 75, then 100 again");
  // \tempo "rit." 4 = 60: the words with the speed to reach, from the speed before them.
  const target = read("{ \\tempo 4 = 120 c'1 | \\tempo \"rit.\" 4 = 60 c'1 | \\tempo \"Andante\" c'1 }");
  assert.deepEqual(M.tempoRamps(target), [{ t0: M.WHOLE, t1: 2 * M.WHOLE, q0: 120, q1: 60 }]);
  // No ramp: no curve, and the passes as they always were.
  const plain = read("{ \\tempo 4 = 90 c'1 | \\tempo \"Allegro\" c'1 }");
  assert.deepEqual(M.tempoRamps(plain), []);
  assert.ok(M.playback(plain).every((p) => !p.curve && !p.steps));
});

test("ramps: a fermata inside a glide, and a repeat: the MIDI and the model still agree", () => {
  const score = read(
    "{ \\tempo 4 = 120 \\repeat volta 2 { c'4 d' e' f' | \\override TextSpanner.bound-details.left.text = \"rall.\" g'4\\startTextSpan g'\\fermata g' g' | g'4 g' g'\\stopTextSpan g' } | \\tempo 4 = 120 a'4 a' a' a' }",
  );
  const { passes, felt } = heard(score);
  assert.equal(passes.length, 7, "the repeat played out");
  const ons = onsetSeconds(felt);
  // Every pass's first note where the pass starts.
  for (const p of passes) assert.ok(ons.some((x) => Math.abs(x - p.start) < 0.002), `pass of bar ${p.bar} at ${p.start}`);
  // The second time through, the first bar is at 120 again.
  assert.ok(Math.abs(passes[3].end - passes[3].start - 2) < 1e-9);
  close(ons.slice(-4), modelOnsets(score, passes).slice(-4), 0.002, "the last bar");
});

test("ramps: the metronome and the MIDI clock glide with the music", () => {
  const score = read("{ \\tempo 4 = 120 c'1 | \\tempo \"rit.\" c'1 | \\tempo 4 = 60 c'1 }");
  const passes = M.playback(score);
  const clicks = M.beats(score, passes).map((b) => b.sec);
  close(clicks.slice(0, 5), [0, 0.5, 1, 1.5, 2], 1e-9, "at 120");
  // One bar of rit., 120 to 60: 4 ln 2 seconds.
  assert.ok(Math.abs(passes[2].start - (2 + 4 * Math.log(2))) < 1e-9);
  close(clicks.slice(8), [0, 1, 2, 3].map((k) => passes[2].start + k), 1e-9, "at 60");
  // The clock: a pulse every 24th of a quarter, wherever the quarter falls.
  const line = S.timeline(passes, M.WHOLE);
  for (let q = 4; q <= 8; q++) assert.ok(Math.abs(S.secAtQuarter(line, q) - clicks[q]) < 1e-6, `quarter ${q}`);
  assert.ok(Math.abs(S.quarterAt(line, clicks[6]) - 6) < 1e-6);
  // Subdivided: the eighths between, softer; the downbeats still marked.
  const eighths = M.beats(score, passes, { subdivide: 8 });
  assert.equal(eighths.length, 24);
  assert.deepEqual(eighths.slice(0, 3).map((b) => [b.down, Boolean(b.sub)]), [[true, false], [false, true], [false, false]]);
  assert.equal(M.beats(score, passes, { subdivide: 16 }).length, 48);
  // In 6/8 the beat is the eighth: an eighth's subdivision adds nothing.
  const six = read("{ \\time 6/8 c'4. c'4. }");
  assert.equal(M.beats(six, M.playback(six), { subdivide: 8 }).length, 6);
  assert.equal(M.beats(six, M.playback(six), { subdivide: 16 }).length, 12);
});

// ---- Swing ----------------------------------------------------------------------------

test("swing: the pair's edges stay, its middle moves", () => {
  assert.equal(F.swingTick(0, 0, 100, 0.66), 0);
  assert.equal(F.swingTick(100, 0, 100, 0.66), 132);
  assert.equal(F.swingTick(200, 0, 100, 0.66), 200);
  assert.equal(F.swingTick(150, 0, 100, 0.75), 175);
  assert.equal(F.swingTick(1100, 1000, 100, 0.5), 1100, "50 %: even");
  assert.equal(F.swingOf({ amount: 50 }), null);
  assert.equal(F.swingOf(null), null);
  assert.deepEqual(F.swingOf({ amount: 90, unit: 16 }), { amount: 0.75, unit: 16 });
});

test("swing: played eighths go long-short, counted from each bar line, written notes untouched", () => {
  const score = read("{ \\tempo 4 = 60 \\partial 8 b8 | c'8 d' e' f' g'4 a'4 }");
  const { bytes, felt } = heard(score, { swing: { amount: 66.6667, unit: 8 } });
  assert.equal(F.feel(bytes, { score, passes: M.playback(score) }), bytes, "nothing asked: the same bytes");
  const swung = onsetSeconds(felt);
  // The pickup bar is an eighth long: its b' on the bar's beat, then c' on the next bar line.
  close(swung, [0, 0.5, 0.5 + 2 / 3, 1.5, 1.5 + 2 / 3, 2.5, 3.5], 0.002);
  // The notes' lengths follow: the first of a pair ends where the second starts.
  const { on, off, division } = notesOf(felt);
  const c = on.find((n) => n.key === 60);
  assert.equal(off.find((n) => n.key === 60).tick - c.tick, Math.round((division * 2) / 3));
  // Sixteenths swing within each eighth.
  const sixteenths = read("{ \\tempo 4 = 60 c'16 d' e' f' }");
  close(onsetSeconds(heard(sixteenths, { swing: { amount: 75, unit: 16 } }).felt), [0, 0.375, 0.5, 0.875], 0.002);
});

test("swing: a piece edited in its text swings from its start", () => {
  const bytes = midi("{ \\tempo 4 = 60 c'8 d' e' f' }", 100, 4, 0);
  close(onsetSeconds(F.feel(bytes, { swing: { amount: 75, unit: 8 } })), [0, 0.75, 1, 1.75], 0.002);
});

// ---- Humanize -------------------------------------------------------------------------

test("humanize: within the bounds, the same for the same seed, another take for another", () => {
  const score = read("{ \\tempo 4 = 120 c'8 d' e' f' g' a' b' c'' | c''8 b' a' g' f' e' d' c' | <c' e' g'>1 }");
  const plain = heard(score).bytes;
  const take = (seed) => heard(score, { humanize: { time: 20, velocity: 10, seed } }).felt;
  const one = take(7);
  assert.deepEqual(one, take(7), "repeatable");
  assert.notDeepEqual(one, take(8), "another take");
  const before = onsetSeconds(plain);
  const { on, off } = notesOf(one);
  const base = notesOf(plain);
  // Each note within 20 ms of where it was written, its velocity within 10 %.
  const sec = (bytes) => onsetSeconds(bytes);
  const after = sec(one);
  assert.ok(after.length >= before.length - 2, "the chord's notes may part a little");
  for (const n of on) {
    const was = base.on.filter((m) => m.key === n.key);
    assert.ok(was.length, "no new key");
    assert.ok(n.velocity >= Math.floor(90 * 0.9) && n.velocity <= Math.ceil(90 * 1.1), `velocity ${n.velocity}`);
  }
  const moved = after.filter((x) => !before.some((y) => Math.abs(x - y) < 1e-4));
  assert.ok(moved.length > 4, "the timing changed");
  for (const x of after) assert.ok(before.some((y) => Math.abs(x - y) <= 0.0205), `${x} within 20 ms`);
  // No note ends before it starts, nor after the same key is struck again.
  for (const key of new Set(on.map((n) => n.key))) {
    const ons = on.filter((n) => n.key === key).map((n) => n.tick).sort((a, b) => a - b);
    const offs = off.filter((n) => n.key === key).map((n) => n.tick).sort((a, b) => a - b);
    ons.forEach((t, k) => {
      assert.ok(offs[k] >= t, `key ${key}: ends after it starts`);
      if (ons[k + 1] != null) assert.ok(offs[k] <= ons[k + 1], `key ${key}: ends before it is struck again`);
    });
  }
  assert.equal(F.humanizeOf({ time: 0, velocity: 0 }), null);
  assert.deepEqual(F.humanizeOf({ time: 500, velocity: 99 }), { time: 100, velocity: 50, seed: 1 });
});

test("humanize: a random draw is in [-1, 1) and repeats from its seed", () => {
  const a = F.random(3);
  const b = F.random(3);
  const draws = Array.from({ length: 200 }, () => a());
  assert.deepEqual(draws, Array.from({ length: 200 }, () => b()));
  assert.ok(draws.every((x) => x >= -1 && x < 1));
  assert.ok(draws.some((x) => x < -0.5) && draws.some((x) => x > 0.5));
});

test("midi files: read and written again, byte for byte", () => {
  const bytes = midi("\\new PianoStaff << \\new Staff { \\tempo 4 = 72 c'4 d'\\fermata <e' g'>2 } \\new Staff { \\clef bass c2 g, } >>", 100, 4, 0);
  assert.deepEqual(F.writeSmf(F.readSmf(bytes)), bytes);
  const events = F.tempoEvents(read("{ \\tempo 4 = 72 c'1 | c'1 }"), M.playback(read("{ \\tempo 4 = 72 c'1 | c'1 }")), 6720);
  assert.equal(events.length, 1, "one tempo, said once");
  assert.equal((events[0].data[3] << 16) | (events[0].data[4] << 8) | events[0].data[5], Math.round(60e6 / 72));
});

// ---- Quantize -------------------------------------------------------------------------

const sixteenth = M.notated(16);
const eighth = M.notated(8);
const lane = (score) =>
  score.staves[0].events.map((ev, i) => `${M.starts(score.staves[0])[i] / sixteenth}:${ev.rest ? "r" : ev.pitches.map((p) => p.d).join("+")}${ev.arts.length ? `(${ev.arts})` : ""}`).join(" ");

test("quantize: starts to the grid, lengths kept or fitted, what is written on a note goes with it", () => {
  // Off the eighths by a thirty-second: c' late, e' early.
  const src = "{ r32 c'8..-> d'8.. e'32 r8 f'4 r8 }";
  const score = read(src);
  const end = M.barStart(score, 1);
  assert.equal(M.quantizeLane(score, 0, 0, end, { grid: M.RECORDING_GRIDS.eighth, strength: 1 }), 2);
  assert.match(lane(score), /^0:7\(accent\) /, "c' on the beat, its accent with it");
  assert.match(lane(score), / 4:8 .*8:9 /, "d' where it was, e' on the eighth");
  assert.equal(score.staves[0].events[0].base, 8, "c' as long as it was: an eighth and two thirty-seconds");
  assert.equal(score.staves[0].events[0].dots, 2);
  assert.doesNotThrow(() => editor_view(M.toLilyPond(score).source, 900, 7, -1, -1));
  // Starts and ends: the lengths fitted too.
  const both = read("{ c'16. r32 d'8 e'8 f'8 g'2 }");
  const kept = structuredClone(both);
  M.quantizeLane(kept, 0, 0, M.barStart(kept, 1), { grid: M.RECORDING_GRIDS.eighth });
  assert.match(M.toLilyPond(kept).source, /c'16\. r32 d'8/, "starts only: c' keeps its length");
  assert.equal(M.quantizeLane(both, 0, 0, M.barStart(both, 1), { grid: M.RECORDING_GRIDS.eighth, ends: true }), 1);
  assert.equal(M.toLilyPond(both).source.match(/c'8 d'8 e'8 f'8 g'2/)?.[0], "c'8 d'8 e'8 f'8 g'2");
  // Already on the grid: nothing moves, nothing changes.
  const on = read("{ c'8 d' e' f' g'2 }");
  const before = M.toLilyPond(on).source;
  assert.equal(M.quantizeLane(on, 0, 0, M.barStart(on, 1), { grid: M.RECORDING_GRIDS.eighth }), 0);
  assert.equal(M.toLilyPond(on).source, before);
});

test("quantize: part of the way, only the selection, notes landing together a chord", () => {
  const half = read("{ r32 c'8.. d'2. }");
  M.quantizeLane(half, 0, 0, M.barStart(half, 1), { grid: M.RECORDING_GRIDS.eighth, strength: 0.5 });
  // A thirty-second late, half of it taken back: a sixty-fourth late.
  assert.equal(M.starts(half.staves[0])[1], M.notated(64));
  // Only the notes from `from` to `to` move.
  const two = read("{ r16 c'8. d'2. | r16 e'8. f'2. }");
  M.quantizeLane(two, 0, 0, M.barStart(two, 1), { grid: M.RECORDING_GRIDS.quarter });
  assert.equal(M.starts(two.staves[0]).filter((t, i) => !two.staves[0].events[i].rest)[0], 0);
  assert.match(M.toLilyPond(two).source, /\| r16 e'8\. f'2\./, "the next bar as it was");
  // Two notes to one step: one chord.
  const chord = read("{ c'16 e'16 r8 r2. }");
  M.quantizeLane(chord, 0, 0, M.barStart(chord, 1), { grid: M.RECORDING_GRIDS.quarter, ends: true });
  assert.deepEqual(chord.staves[0].events[0].pitches.map((p) => p.d), [7, 9]);
  assert.throws(() => M.quantizeLane(chord, 0, 0, 10, { grid: 0 }), /grid/);
  assert.throws(() => M.quantizeLane(chord, 9, 0, 10, { grid: eighth }), /staff/);
});

test("quantize: to a triplet grid, the notes are written as a recording is", () => {
  const score = read("{ c'8 d'16 e'16 f'2. }");
  const n = M.quantizeLane(score, 0, 0, M.barStart(score, 1), { grid: M.RECORDING_GRIDS["eighth-triplet"] });
  assert.ok(n >= 1);
  const { source } = M.toLilyPond(score);
  assert.match(source, /\\tuplet 3\/2/);
  assert.doesNotThrow(() => editor_view(source, 900, 7, -1, -1));
  // The pitches kept, in their order: d' and e', both nearest the triplet's second step, a chord there.
  const notes = score.staves[0].events.filter((ev) => !ev.rest).map((ev) => ev.pitches.map((p) => p.d).join("+"));
  assert.deepEqual([...new Set(notes)], ["7", "8+9", "10"]);
});

// ---- Swing written --------------------------------------------------------------------

test("written swing: even eighths on the beat become triplets or dotted pairs; the rest is left", () => {
  const src = "{ c'8 d' e' f' g'4 a'8 b' | c''8. d''16 e''8 f'' g''2 }";
  const triplets = read(src);
  assert.equal(M.writeSwing(triplets, 0, 0, M.barStart(triplets, 2), { unit: 8, feel: "triplet" }), 4);
  const out = M.toLilyPond(triplets).source;
  assert.match(out, /\\tuplet 3\/2 \{ c'4 d'8 \} \\tuplet 3\/2 \{ e'4 f'8 \} g'4 \\tuplet 3\/2 \{ a'4 b'8 \}/);
  assert.match(out, /c''8\. d''16 \\tuplet 3\/2 \{ e''4 f''8 \} g''2/, "an uneven pair left as it is");
  assert.doesNotThrow(() => editor_view(out, 900, 7, -1, -1));
  const dotted = read(src);
  assert.equal(M.writeSwing(dotted, 0, 0, M.barStart(dotted, 1), { unit: 8, feel: "dotted" }), 3);
  assert.match(M.toLilyPond(dotted).source, /c'8\. d'16 e'8\. f'16 g'4 a'8\. b'16 \| c''8\. d''16 e''8 f''8/);
  // Off the beat: not a pair.
  const off = read("{ c'8 d'4 e'8 f'8 g'8 a'4 }");
  assert.equal(M.writeSwing(off, 0, 0, M.barStart(off, 1), { feel: "dotted" }), 1);
  assert.throws(() => M.writeSwing(off, 0, 0, 1, { unit: 4 }), /eighths or sixteenths/);
});

// ---- With each note's velocity (#378) ----------------------------------------------------

test("with velocities: swung, humanized and gliding over the velocities set, as studio.js heardMidi does", () => {
  // d' set to 30, f' to 120 (velocity.js keeps them by "lane:tick:key"); swung 75 %, humanized ±10 %.
  const velocity = { [`0:${eighth}:62`]: 30, [`0:${3 * eighth}:65`]: 120 };
  const src = M.writeMeta("{ \\tempo 4 = 60 c'8 d' e' f' g'2 | \\tempo \"rit.\" c'1 | \\tempo 4 = 30 c'1 }\n", {
    velocity,
    swing: { amount: 75, unit: 8 },
    humanize: { time: 0, velocity: 10, seed: 3 },
  });
  const score = read(src);
  const passes = M.playback(score);
  const raw = midi(M.toLilyPond(score, { unfold: true }).source, M.DEFAULT_BPM, 4, 0);
  const withVelocities = Vel.applyVelocities(score, raw);
  const out = F.feel(withVelocities, { score, passes, ...F.feelOf(score.meta) });
  const { on } = notesOf(out);
  const key = (k) => on.find((n) => n.key === k).velocity;
  // The velocities set, give or take the humanize's 10 %.
  assert.ok(key(62) >= 27 && key(62) <= 33, `d' ${key(62)}`);
  assert.ok(key(65) >= 108 && key(65) <= 127, `f' ${key(65)}`);
  // The others at the engraver's own, give or take 10 %.
  assert.ok(key(64) >= 81 && key(64) <= 99, `e' ${key(64)}`);
  // Swung, and the rit. still gliding to 30 a quarter.
  const ons = onsetSeconds(out);
  close(ons.slice(0, 5), [0, 0.75, 1, 1.75, 2], 0.002, "swung");
  close(ons.slice(5), modelOnsets(score, passes).slice(5), 0.002, "the rit.");
  assert.ok(ons[6] - ons[5] > 4 * 60 / 60, "the rit.'s bar longer than a bar at 60");
  // Without humanize, the set velocities exactly.
  const plain = notesOf(F.feel(withVelocities, { score, passes, swing: score.meta.swing }));
  assert.equal(plain.on.find((n) => n.key === 62).velocity, 30);
  assert.equal(plain.on.find((n) => n.key === 65).velocity, 120);
});
