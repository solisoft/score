// Retrograde and inversion over a selection (#1024). Retrograde: the notes
// and rests backwards, each with its length and its marks, the ties, slurs
// and hairpins turned round with them; the syllables sung stay in their
// order. Inversion: every note mirrored around the first note, by the key's
// own letters (diatonic), a note the key does not hold flipping its sharp or
// flat. Refused on a tuplet, on a selection of rests, and past what can be
// written.
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

function written(score, lane = 0) {
  return score.staves[lane].events.map((ev) => {
    const name = ev.rest ? "r" : ev.pitches.length > 1 ? `<${ev.pitches.map((p) => M.spellPitch(p.d, p.alter)).join(" ")}>` : M.spellPitch(ev.pitches[0].d, ev.pitches[0].alter);
    return `${name}${ev.base}${".".repeat(ev.dots)}${ev.tie ? "~" : ""}`;
  }).join(" ");
}
const all = (score, lane = 0) => [{ s: lane, a: 0, b: score.staves[lane].events.length - 1 }];

test("retrograde: the notes and rests backwards, each keeping its length", () => {
  const score = open(`{ c'4 d'8 e'8 r4 f'4 }`);
  T.retrograde(score, all(score));
  assert.equal(written(score), "f'4 r4 e'8 d'8 c'4");
});

test("retrograde: a tie goes from the note now first to the one after it", () => {
  const score = open(`{ c'4 d'4~ d'4 e'4 }`);
  T.retrograde(score, all(score));
  assert.equal(written(score), "e'4 d'4~ d'4 c'4");
});

test("retrograde: slurs and hairpins turned round, a crescendo now a diminuendo; dynamics stay on their notes", () => {
  const score = open(`{ c'4\\p( d'4\\< e'4) f'4\\! }`);
  T.retrograde(score, all(score));
  const events = score.staves[0].events;
  assert.deepEqual(events.map((ev) => [ev.slurStart, ev.slurEnd]), [[false, false], [true, false], [false, false], [false, true]]);
  assert.deepEqual(events.map((ev) => ev.hairpin), [">", null, null, null]);
  assert.deepEqual(events.map((ev) => ev.hairpinEnd), [false, false, true, false]);
  assert.equal(events[3].dynamic, "p");
});

test("retrograde: the syllables keep their order under the reversed notes", () => {
  const score = open(`<< \\new Staff { \\new Voice = "v" { c'4 d'4 e'4 f'4 } } \\new Lyrics \\lyricsto "v" { one two three four } >>`);
  const sung = () => score.staves[0].events.map((ev) => M.syllableOf(ev)?.text ?? ev.lyric?.text ?? "");
  const before = sung();
  assert.deepEqual(before, ["one", "two", "three", "four"]);
  T.retrograde(score, all(score));
  assert.equal(written(score), "f'4 e'4 d'4 c'4");
  assert.deepEqual(sung(), before);
});

test("retrograde twice gives back the music; a tuplet is refused", () => {
  const score = open(`{ c'4( d'8 e'8) f'4~ f'4 }`);
  const source = M.toLilyPond(score).source;
  T.retrograde(score, all(score));
  T.retrograde(score, all(score));
  assert.equal(M.toLilyPond(score).source, source);
  const triplets = open(`{ \\tuplet 3/2 { c'8 d' e' } f'4 g'2 }`);
  assert.throws(() => T.retrograde(triplets, all(triplets)), /tuplet/);
});

test("inversion around the first note, in C major: up a third becomes down a third", () => {
  const score = open(`{ c'4 e'4 g'4 c''4 }`);
  T.invert(score, all(score));
  assert.equal(written(score), "c'4 a4 f4 c4");
});

test("inversion in the key: G major's own letters; chords mirrored and kept in order", () => {
  const score = open(`{ \\key g \\major g'4 b'4 <d'' fis''>2 }`);
  T.invert(score, all(score));
  assert.equal(written(score), "g'4 e'4 <a c'>2");
});

test("inversion: a sharp the key does not hold becomes a flat; the first note's own letter keeps its sign", () => {
  const score = open(`{ c'4 fis'4 cis''4 r4 }`);
  T.invert(score, all(score));
  assert.equal(written(score), "c'4 ges4 cis4 r4");
  const sharp = open(`{ cis'4 e'4 }`);
  T.invert(sharp, all(sharp));
  assert.equal(written(sharp), "cis'4 a4 r2");
});

test("inversion over two staves: each around its own first note", () => {
  const score = open(`<< \\new Staff { c''4 d''4 e''2 } \\new Staff { \\clef bass g4 f4 e2 } >>`);
  T.invert(score, T.barRanges(score, [0, 1], 0, 0));
  assert.equal(written(score, 0), "c''4 b'4 a'2");
  assert.equal(written(score, 1), "g4 a4 b2");
});

test("inversion refused: rests alone, and a note past what can be written; nothing changed", () => {
  const rests = open(`{ r1 }`);
  assert.throws(() => T.invert(rests, all(rests)), /note/);
  const wide = open(`{ c''''4 c4 r2 }`);
  const before = written(wide);
  assert.throws(() => T.invert(wide, all(wide)), /far/);
  assert.equal(written(wide), before);
});
