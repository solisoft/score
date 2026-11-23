// A passage of a plain staff divided in two (#1021): the bars' chords split
// between the staff's first voice (their upper notes) and a second one (the
// lower), "div." over the first note and "unis." after the bars; the other
// bars untouched; refused where it cannot be written, nothing changed.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

function withSpans(text) {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return parsed;
}
const open = (src) => M.fromParsed(withSpans(src), src, { parse: withSpans }).score;

/** The model's text, which the engraver draws. */
function written(score) {
  const { source } = M.toLilyPond(score);
  assert.doesNotThrow(() => editor_view(source, 900, 7, -1, -1), source);
  return source;
}

const notes = (score, s) => score.staves[s].events.map((ev) => (ev.rest ? "r" : ev.pitches.map((p) => M.spellPitch(p.d, p.alter)).join("+")) + ev.base + ".".repeat(ev.dots));
const words = (score, s) => score.staves[s].events.map((ev) => ev.texts.map((t) => t.text).join(","));

// Violins: a bar alone, two bars of thirds (and a note both play), a bar after them.
const VIOLINS = `\\new Staff \\with { instrumentName = "Violins" } { c''1\\f | <c'' e''>4-. <d'' f''>4( <e'' g''>4) r4 | <g' b' d''>2 a'2 | b'1 }`;

test("divisi: the bars' chords split in two voices, the upper notes in voice 1 and the lower in voice 2, div. and unis. written", () => {
  const score = open(VIOLINS);
  assert.equal(M.divisi(score, 0, 1, 2), 1, "answers the second voice's lane");
  assert.deepEqual(M.voiceLanes(score, 0), [0, 1]);
  assert.deepEqual(notes(score, 0), ["c''1", "e''4", "f''4", "g''4", "r4", "b'+d''2", "a'2", "b'1"]);
  // The second voice: rests outside the bars; in them the lower notes, a note alone played by both, the rest too.
  assert.deepEqual(notes(score, 1), ["r1", "c''4", "d''4", "e''4", "r4", "g'2", "a'2", "r1"]);
  // div. over the first note of the bars, unis. over the first note after them; nowhere else, and not in voice 2.
  assert.deepEqual(words(score, 0), ["", "div.", "", "", "", "", "", "unis."]);
  assert.ok(score.staves[1].events.every((ev) => !ev.texts.length && !ev.dynamic));
  // What is each player's goes to both: the dots, the slur.
  assert.deepEqual(score.staves[1].events[1].arts, ["staccato"]);
  assert.ok(score.staves[1].events[2].slurStart && score.staves[1].events[3].slurEnd);
  const source = written(score);
  assert.match(source, /c''1\\f \| << \{ e''4-\.\^"div\." f''4\( g''4\) r4 \} \\\\ \{ c''4-\. d''4\( e''4\) r4 \} >> \| << \{ <b' d''>2 a'2 \} \\\\ \{ g'2 a'2 \} >> \| b'1\^"unis\."/);
  // Read back: the same two voices.
  const again = open(source);
  assert.deepEqual(notes(again, 1), notes(score, 1));
  assert.deepEqual(words(again, 0), words(score, 0));
});

test("divisi: the page's words for div. and unis.; one bar; the last bars (nothing after them to mark); triplets", () => {
  const score = open(VIOLINS);
  M.divisi(score, 0, 2, 2, { div: "div. a 2", unis: "tutti" });
  assert.deepEqual(words(score, 0), ["", "", "", "", "", "div. a 2", "", "tutti"]);
  assert.deepEqual(notes(score, 1), ["r1", "r1", "g'2", "a'2", "r1"]);
  written(score);
  // The last bar: div. alone.
  const last = open("\\new Staff { c''1 | <c'' e''>2 <d'' f''>2 }");
  M.divisi(last, 0, 1, 1);
  assert.deepEqual(words(last, 0), ["", "div.", ""]);
  written(last);
  // Again on the same bars: a second voice plays there already.
  assert.throws(() => M.divisi(last, 0, 1, 1), /second voice plays in these bars already/);
  // The bar before bars divided already: one division, said once where it starts and once where it ends.
  M.divisi(score, 0, 1, 1, { div: "div. a 2", unis: "tutti" });
  assert.deepEqual(notes(score, 1), ["r1", "c''4", "d''4", "e''4", "r4", "g'2", "a'2", "r1"]);
  assert.deepEqual(words(score, 0), ["", "div. a 2", "", "", "", "", "", "tutti"]);
  written(score);
  // And the bar after bars divided: the division goes on to its end.
  const on = open(VIOLINS);
  M.divisi(on, 0, 1, 1);
  M.divisi(on, 0, 2, 2);
  assert.deepEqual(words(on, 0), ["", "div.", "", "", "", "", "", "unis."]);
  // Triplets of chords: each voice its own triplet.
  const triplets = open("\\new Staff { \\tuplet 3/2 { <c'' e''>4 <d'' f''>4 <e'' g''>4 } <c'' e''>2 | c''1 }");
  M.divisi(triplets, 0, 0, 0);
  assert.deepEqual(notes(triplets, 1), ["c''4", "d''4", "e''4", "c''2", "r1"]);
  assert.ok(triplets.staves[1].events[0].tuplet && triplets.staves[1].events[0].tuplet.id !== triplets.staves[0].events[0].tuplet.id);
  assert.match(written(triplets), /\\\\ \{ \\tuplet 3\/2 \{ c''4 d''4 e''4 \} c''2 \}/);
});

test("divisi: refused, and said, where it cannot be written — nothing changes", () => {
  const refused = (src, pattern, a = 0, b = 0, s = 0) => {
    const score = open(src);
    const was = JSON.stringify(score);
    assert.throws(() => M.divisi(score, s, a, b), pattern, src);
    assert.equal(JSON.stringify(score), was, `nothing changed: ${src}`);
  };
  refused("\\new Staff { r1 | c''1 }", /hold no note to divide/);
  refused("\\new Staff { c''1 | c''1 }", /no such bar/, 0, 5);
  refused("\\new Staff { c''1 | c''1 }", /no such staff/, 0, 0, 7);
  refused("\\new Staff { << { <e'' g''>1 } \\\\ { c''1 } >> | c''1 }", /second voice plays in these bars already/);
  refused("\\new Staff \\partCombine { c''1 } { a'1 }", /holds two parts already/);
  refused("\\new DrumStaff \\drummode { sn4 sn sn sn }", /staff of notes/);
  refused("\\new Staff \\partCombineUp { c''4 d'' e'' f'' } { a'4 b' c''2 }", /kept as LilyPond wrote it/);
});
