// A section of the shared library put in one's own score (#451):
// importSection (public/eui-score/section-library.js) on scores the real
// engraver read, with sections made the way the library makes them.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import { importSection } from "../../public/eui-score/section-library.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
const house = JSON.parse(readFileSync(new URL("../../db/data/house_sections.json", import.meta.url)));
const seed = (id) => house.find((s) => s.seed === id);
const named = (score) => M.staffLanes(score).map((s) => score.staves[s].name);
const pitchedIn = (score, s, a, b) => {
  const at = M.starts(score.staves[s]);
  return score.staves[s].events.filter((ev, i) => !ev.rest && M.barAt(score, at[i]) >= a && M.barAt(score, at[i]) <= b).length;
};
const engraves = (score) => JSON.parse(editor_view(M.toLilyPond(score).source, 1200, 7, -1, -1));

test("into a score with music: after its last bar, on a staff of its own instrument, nothing written over", () => {
  const score = read(String.raw`\new Staff \with { instrumentName = "Voice" } { \time 4/4 c'1 | d'1 }`);
  const done = importSection(score, seed("style:folk:bass"), score_json);
  assert.equal(done.at, 2);
  assert.deepEqual(done.added, ["Bass"]);
  assert.deepEqual(named(score), ["Voice", "Bass"]);
  assert.equal(M.barsOf(score), 6);
  assert.equal(pitchedIn(score, 0, 0, 1), 2, "the melody as it was");
  assert.equal(pitchedIn(score, 0, 2, 5), 0);
  assert.ok(pitchedIn(score, 1, 2, 5) > 0, "the bass in the new bars");
  assert.equal(pitchedIn(score, 1, 0, 1), 0, "and only there");
  engraves(score);
  // The same again: on the bass staff it has now, after the bars it added.
  const again = importSection(score, seed("style:country:bass"), score_json);
  assert.deepEqual(again.added, []);
  assert.equal(again.at, 6);
  assert.equal(M.staffLanes(score).length, 2);
});

test("into an empty score: from its first bar; the whole band on its staves; a groove on the drums", () => {
  const score = read(String.raw`{ \time 4/4 r1 | r1 }`);
  const band = importSection(score, seed("style:pop:band"), score_json);
  assert.equal(band.at, 0);
  assert.equal(M.barsOf(score), 4);
  const back = read(M.toLilyPond(score).source);
  assert.ok(M.staffLanes(back).some((s) => M.isDrums(back, s)), "a drum staff");
  engraves(score);
  const before = M.staffLanes(score).length;
  const groove = importSection(score, seed("groove:funk:loop1"), score_json);
  assert.equal(groove.at, 4);
  assert.deepEqual(groove.added, [], "on the drum staff there");
  assert.equal(M.staffLanes(score).length, before);
  engraves(score);
});

test("a section in another metre changes the metre where it goes; what is refused", () => {
  const score = read(String.raw`\new Staff { \time 4/4 c'1 }`);
  importSection(score, seed("style:waltz:piano"), score_json);
  assert.deepEqual(M.timeAt(score, 0), [4, 4]);
  assert.deepEqual(M.timeAt(score, 1), [3, 4]);
  engraves(score);
  assert.throws(() => importSection(score, { section: { bars: 0, parts: [] }, source: "{ c'1 }" }, score_json), /holds no bars/);
});

test("a piano comes with its brace, named; added again, it goes on that brace's staves", () => {
  const score = read(String.raw`\new Staff \with { instrumentName = "Voice" } { \time 4/4 c'1 }`);
  const done = importSection(score, seed("style:pop:piano"), score_json);
  assert.deepEqual(done.added, ["Piano"]);
  const brace = score.groups.find((g) => g.kind === "brace" && g.name === "Piano");
  assert.ok(brace, "the piano's brace");
  assert.equal(brace.last - brace.first, 1);
  assert.equal(M.staffLanes(score).length, 3);
  const back = read(M.toLilyPond(score).source);
  assert.ok(back.groups.some((g) => g.kind === "brace" && g.name === "Piano"), "kept in the text");
  const again = importSection(score, seed("style:rock:piano"), score_json);
  assert.deepEqual(again.added, []);
  assert.equal(M.staffLanes(score).length, 3);
  engraves(score);
});

test("swing goes along (#453): kept in a shared section, set on a straight score it is added to, heard swung", async () => {
  const { shareable } = await import("../../public/eui-score/section-library.js");
  const F = await import("../../public/eui-score/feel.js");
  const swung = read(String.raw`\new Staff { \time 4/4 c'8 d' e' f' g' a' b' c'' }`);
  swung.meta = { swing: { amount: 62, unit: 8 } };
  const shared = shareable(swung, [0], 0, 0, "Swung");
  assert.deepEqual(M.readMeta(shared.source).swing, { amount: 62, unit: 8 }, "the section's text says it swings");
  const straight = read(String.raw`\new Staff { \time 4/4 c'1 }`);
  assert.equal(shareable(straight, [0], 0, 0, "Straight").source.includes("%% eui-score"), false);
  const score = read(String.raw`\new Staff \with { instrumentName = "Voice" } { \time 4/4 c'1 }`);
  const done = importSection(score, seed("style:swing:bass"), score_json);
  assert.equal(done.swung, true);
  assert.deepEqual(score.meta.swing, { amount: 66, unit: 8 });
  assert.equal(importSection(score, seed("style:shuffle:bass"), score_json).swung, false, "a score that swings keeps its own");
  assert.deepEqual(score.meta.swing, { amount: 66, unit: 8 });
  assert.equal(importSection(read(String.raw`{ c'1 }`), seed("style:pop:bass"), score_json).swung, false);
  // Heard: the off-beat eighth comes late.
  const bytes = new Uint8Array(midi(M.toLilyPond(swung, { unfold: true }).source, 100, 4, 0));
  const ons = (b) => F.readSmf(b).tracks.flat().filter((ev) => (ev.data[0] & 0xf0) === 0x90 && ev.data[2] > 0).map((ev) => ev.tick);
  const straightTicks = ons(bytes);
  const swungTicks = ons(F.feel(bytes, F.feelOf(swung.meta)));
  assert.equal(swungTicks.length, 8);
  assert.notDeepEqual(swungTicks, straightTicks, "the eighths are not even any more");
  const division = F.readSmf(bytes).division;
  assert.equal(straightTicks[1] - straightTicks[0], division / 2, "written even");
  assert.ok(swungTicks[1] - swungTicks[0] > division / 2, "played long-short");
});

test("a groove's force goes along (#455): kept in the shared section, then on the staff it is added to", async () => {
  const { shareable } = await import("../../public/eui-score/section-library.js");
  const G = await import("../../public/eui-score/patterns.js");
  const D = await import("../../public/eui-score/drums.js");
  const Vel = await import("../../public/eui-score/velocity.js");
  const kit = read(String.raw`\new DrumStaff \with { instrumentName = "Drums" } \drummode { \time 4/4 r1 | r | r | r }`);
  G.writeGroove(kit, 0, 0, 3, D.grooveOf("funk"), { feel: true });
  const shared = shareable(kit, [0], 1, 2, "Funk");
  const meta = M.readMeta(shared.source);
  const forces = Object.values(meta.velocity ?? {});
  assert.ok(forces.length > 20, "two bars of forces");
  assert.ok(Math.min(...forces) <= 40 && Math.max(...forces) >= 105, "ghosts and backbeats");
  assert.deepEqual(meta.humanize, D.DRUMMER_FEEL);
  const score = read(String.raw`\new Staff \with { instrumentName = "Voice" } { \time 4/4 c'1 | d'1 }`);
  importSection(score, { title: "Funk", ...shared }, score_json);
  const ids = new Set(Vel.velocityNotes(score).map((n) => n.id));
  const moved = Object.keys(score.meta.velocity ?? {});
  assert.equal(moved.length, forces.length, "every force");
  assert.ok(moved.every((id) => ids.has(id)), "each on a note of the score, in its new bars");
  assert.deepEqual(score.meta.humanize, D.DRUMMER_FEEL);
});
