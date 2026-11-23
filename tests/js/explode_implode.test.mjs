// Explode and implode (#1024). Explode: the chords of the first staff
// selected spread over the staves selected under it, the top note on the
// top staff, down to the lowest — a chord of fewer notes giving its lowest
// to the staves left, a single note to all; one staff selected, onto as
// many staves under it as the largest chord needs. Implode: the notes of
// the staves (or voices) selected merged as chords onto the first, where
// their rhythm matches its own; voices merged leave rests behind them,
// other staves are left as they are.
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
const three = (top) => open(`<< \\new Staff { ${top} } \\new Staff { r1 } \\new Staff { r1 } >>`);

test("explode: the top note to the top staff, the next to the next, down to the lowest", () => {
  const score = three(`<c' e' g'>2 <d' f' a'>2`);
  T.explode(score, T.barRanges(score, [0, 1, 2], 0, 0));
  assert.equal(written(score, 0), "g'2 a'2");
  assert.equal(written(score, 1), "e'2 f'2");
  assert.equal(written(score, 2), "c'2 d'2");
});

test("explode: a chord of fewer notes gives its lowest to the staves left; a single note goes to all; rests stay rests", () => {
  const score = three(`<c' e'>4 g'4 r2`);
  T.explode(score, T.barRanges(score, [0, 1, 2], 0, 0));
  assert.equal(written(score, 0), "e'4 g'4 r2");
  assert.equal(written(score, 1), "c'4 g'4 r2");
  assert.equal(written(score, 2), "c'4 g'4 r2");
});

test("explode from one staff: onto as many staves under it as the largest chord needs, the others untouched", () => {
  const score = open(`<< \\new Staff { <c' e' g'>1 } \\new Staff { c''1 } \\new Staff { d''1 } \\new Staff { e''1 } >>`);
  T.explode(score, [{ s: 0, a: 0, b: 0 }]);
  assert.equal(written(score, 0), "g'1");
  assert.equal(written(score, 1), "e'1");
  assert.equal(written(score, 2), "c'1");
  assert.equal(written(score, 3), "e''1");
});

test("explode: ties stay where the part keeps its pitch; words stay on the top staff", () => {
  const score = open(`<< \\new Staff { \\new Voice = "v" { <c' e'>2~ <c' g'>2 } } \\new Lyrics \\lyricsto "v" { la } \\new Staff { r1 } >>`);
  T.explode(score, T.barRanges(score, [0, 1], 0, 0));
  assert.equal(written(score, 0), "e'2 g'2");
  assert.equal(written(score, 1), "c'2~ c'2");
  assert.equal(score.staves[0].events[0].lyric?.text, "la");
  assert.equal(score.staves[1].events[0].lyric, null);
});

test("explode refused: no chord on one staff, not enough staves under it, a tuplet, drums", () => {
  const plain = open(`<< \\new Staff { c'1 } \\new Staff { r1 } >>`);
  assert.throws(() => T.explode(plain, [{ s: 0, a: 0, b: 0 }]), /chord/);
  const few = open(`<< \\new Staff { <c' e' g'>1 } \\new Staff { r1 } >>`);
  const before = written(few, 1);
  assert.throws(() => T.explode(few, [{ s: 0, a: 0, b: 0 }]), /staves under/);
  assert.equal(written(few, 1), before);
  const triplet = three(`\\tuplet 3/2 { <c' e'>4 <d' f'> <e' g'> } r2`);
  assert.throws(() => T.explode(triplet, T.barRanges(triplet, [0, 1, 2], 0, 0)), /tuplet/);
  const drums = open(`<< \\new Staff { <c' e'>1 } \\new DrumStaff \\drummode { bd1 } >>`);
  assert.throws(() => T.explode(drums, T.barRanges(drums, [0, 1], 0, 0)), /[Dd]rum/);
});

test("implode: the staves under merged as chords onto the first; they are left as they were", () => {
  const score = open(`<< \\new Staff { g'2 a'2 } \\new Staff { e'2 f'2 } \\new Staff { c'2 d'2 } >>`);
  T.implode(score, T.barRanges(score, [0, 1, 2], 0, 0));
  assert.equal(written(score, 0), "<c' e' g'>2 <d' f' a'>2");
  assert.equal(written(score, 1), "e'2 f'2");
});

test("implode: only where the rhythms match; a rest of the first takes the notes under it", () => {
  const score = open(`<< \\new Staff { c''2 d''2 | r2 g'2 } \\new Staff { e'4 e'4 f'2 | e'2 e'2 } >>`);
  T.implode(score, T.barRanges(score, [0, 1], 0, 1));
  assert.equal(written(score, 0), "c''2 <f' d''>2 e'2 <e' g'>2");
});

test("implode the voices of one staff: into voice 1, the notes merged leaving rests in voice 2", () => {
  const score = open(`{ << { g'2 a'2 } \\\\ { c'2 d'4 d'4 } >> }`);
  T.implode(score, T.barRanges(score, [0, 1], 0, 0));
  assert.equal(written(score, 0), "<c' g'>2 a'2");
  assert.equal(written(score, 1), "r2 d'4 d'4");
});

test("implode refused: nothing whose rhythm matches, one staff alone, drums", () => {
  const score = open(`<< \\new Staff { c''2 d''2 } \\new Staff { e'4 e'4 f'4 f'4 } >>`);
  assert.throws(() => T.implode(score, T.barRanges(score, [0, 1], 0, 0)), /match/);
  assert.throws(() => T.implode(score, [{ s: 0, a: 0, b: 1 }]), /several/);
  const drums = open(`<< \\new DrumStaff \\drummode { bd1 } \\new Staff { c'1 } >>`);
  assert.throws(() => T.implode(drums, T.barRanges(drums, [0, 1], 0, 0)), /[Dd]rum/);
});
