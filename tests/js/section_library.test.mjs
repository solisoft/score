// The shared library of sections in the editor (public/eui-score/section-library.js,
// #444): bars made shareable — the section to paste, and a small score of
// their own the real engraver reads, with their metre, key, tempo, clefs
// and instruments — and the section put back into another score.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as L from "../../public/eui-score/section-library.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
const lane = (score, s, b) => {
  const staff = score.staves[s];
  const at = M.starts(staff);
  const [t0, t1] = [M.barStart(score, b), M.barStart(score, b + 1)];
  return staff.events.filter((_, i) => at[i] >= t0 && at[i] < t1).map((ev) => (ev.rest ? "r" : ev.pitches.map((p) => p.drum ?? M.spellPitch(p.d, p.alter)).join(" ")));
};

const BAND = String.raw`<<
\new Staff \with { instrumentName = "Guitar" midiInstrument = "acoustic guitar (nylon)" } { \clef "treble_8" \key g \major \time 3/4 \tempo 4 = 96 g4 b d' | c'2. | d'2. | g2. }
\new Staff \with { instrumentName = "Flute" midiInstrument = "flute" } { \key g \major \time 3/4 d''2. | e''2. | fis''2. | g''2. }
\new Staff \with { instrumentName = "Bass" midiInstrument = "electric bass (finger)" } { \clef bass \key g \major \time 3/4 g,2. | c2. | d2. | g,2. }
\new DrumStaff \drummode { \time 3/4 bd4 sn sn | bd4 sn sn | bd4 sn sn | bd4 sn sn }
>>`;

test("bars made shareable: their section, and a score of their own the engraver reads", () => {
  const score = read(BAND);
  const shared = L.shareable(score, [0], 1, 2, "Waltz strum");
  assert.equal(shared.bars, 2);
  assert.equal(shared.tracks, 1);
  assert.equal(shared.time, "3/4");
  assert.equal(shared.key, "G major");
  assert.equal(shared.bpm, 96);
  assert.equal(shared.instrument, "guitar", "a guitar's bars are a guitar's");
  assert.match(shared.source, /title = "Waltz strum"/);
  assert.match(shared.source, /\\clef "treble_8"/, "its clef");
  assert.match(shared.source, /midiInstrument = "acoustic guitar \(nylon\)"/, "its sound");
  assert.match(shared.source, /\\time 3\/4/);
  assert.match(shared.source, /\\key g \\major/);
  JSON.parse(editor_view(shared.source, 900, 7, -1, -1));
  const own = read(shared.source);
  assert.equal(M.barsOf(own), 2);
  assert.deepEqual(lane(own, 0, 0), ["c'"]);
});

test("tracks apart in the score come out side by side; drums keep their kit; several kinds are a band", () => {
  const score = read(BAND);
  const lanes = M.staffLanes(score);
  const shared = L.shareable(score, [lanes[0], lanes[2], lanes[3]], 0, 0);
  assert.deepEqual(shared.section.parts.map((p) => p.offset), [0, 1, 2], "the flute left out: no gap");
  assert.equal(shared.instrument, "band");
  assert.match(shared.source, /\\new DrumStaff/);
  assert.match(shared.source, /\\clef bass/);
  JSON.parse(editor_view(shared.source, 900, 7, -1, -1));
  const own = read(shared.source);
  assert.equal(M.staffLanes(own).length, 3);
  assert.deepEqual(lane(own, M.staffLanes(own)[2], 0), ["bd", "sn", "sn"]);
  assert.equal(L.shareable(score, [lanes[3]], 0, 1).key, "", "drums alone have no key");
  assert.equal(L.shareable(score, [lanes[3]], 0, 1).instrument, "drums");
  assert.equal(L.shareable(score, [lanes[2]], 0, 1).instrument, "bass");
  assert.equal(L.shareable(score, [lanes[1]], 0, 1).instrument, "winds");
});

test("a shared section, stored as JSON, goes into another score: before a bar or over it", () => {
  // As the server keeps it and answers it.
  const section = JSON.parse(JSON.stringify(L.shareable(read(BAND), [0], 1, 2).section));
  const target = read(String.raw`{ \time 3/4 a'2. | b'2. | c''2. }`);
  M.insertSection(target, 0, 1, section);
  assert.equal(M.barsOf(target), 5);
  assert.deepEqual([0, 1, 2, 3, 4].map((b) => lane(target, 0, b)[0]), ["a'", "c'", "d'", "b'", "c''"]);
  M.pasteSection(target, 0, 0, section);
  assert.deepEqual(lane(target, 0, 0), ["c'"]);
  assert.equal(M.barsOf(target), 5, "over: no bar added");
});

test("nothing to share: no staff chosen, or a tuplet the copy refuses", () => {
  const score = read(BAND);
  assert.throws(() => L.shareable(score, [], 0, 1), /choose a staff/);
  assert.throws(() => L.shareable(read(String.raw`{ \tuplet 3/2 { c'4 d' e' } c'2 }`), [0], 0, 0), /tuplet/);
});
