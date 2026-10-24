// Bars of rest gathered (#362): a part writes \compressMMRests, so a player
// reads R1*12 as one bar with its count; a \compressMMRests the text wrote
// is kept through every edit.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json, svg } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const q = M.notated(4);

function read(src) {
  const result = M.fromParsed(JSON.parse(score_json(src)));
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result;
}

/** The engraver's items for `score`'s text: each one an event of the model. */
function engrave(score) {
  const { source, items } = M.toLilyPond(score);
  let view;
  try {
    view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  } catch (e) {
    throw new Error(`${e.message ?? e}\n${source}`);
  }
  assert.equal(view.items.length, items.length, `the engraver numbers what the model does\n${source}`);
  return source;
}

const DUET = "\\new StaffGroup << \\new Staff \\with { instrumentName = \"Flute\" midiInstrument = \"flute\" } { c''1 | R1*6 | d''1 } \\new Staff \\with { instrumentName = \"Oboe\" midiInstrument = \"oboe\" } { c'1 | d'1 | e'1 | f'1 | g'1 | a'1 | b'1 | c''1 } >>";

test("a part gathers its bars of rest: \\compressMMRests, R1*6", () => {
  const { score } = read(DUET);
  assert.equal(score.compress, undefined, "the full score does not gather");
  assert.doesNotMatch(M.toLilyPond(score).source, /compressMMRests|R1/);
  const part = M.toLilyPond(M.partOf(score, 0)).source;
  assert.match(part, /\\compressMMRests \\new Staff/);
  assert.match(part, /c''1 \| R1\*6 \| d''1/);
  // The engraver draws one bar for the six, with its count over it.
  assert.ok(svg(part, 800, 7, "").includes("1 staff, 3 bars."), "eight bars drawn as three");
  // The oboe's part has nothing to gather.
  const oboe = M.toLilyPond(M.partOf(score, 1)).source;
  assert.match(oboe, /\\compressMMRests/);
  assert.doesNotMatch(oboe, /R1/);
  // The part is a score of its own, read back as the bars it counts.
  const back = read(part).score;
  assert.equal(M.barsOf(back), 8);
  assert.equal(back.compress, true);
});

test("a run of rests stops at a change, a mark, a repeat's edge; a metre of one value only", () => {
  const { score } = read("{ \\time 3/4 c''2. | R2.*2 | \\key g \\major R2.*2 | \\repeat volta 2 { R2.*2 } | \\time 5/8 R8*5 | R8*5 | c''4. d''4 }");
  score.compress = true;
  const source = engrave(score);
  assert.match(source, /c''2\. \| R2\.\*2 \| \\key g \\major R2\.\*2 \| \\repeat volta 2 \{ R2\.\*2 \}/);
  // 5/8 is no one value: written bar by bar.
  assert.doesNotMatch(source, /R8|R2\.\*\d \| \\time 5\/8 R/);
  assert.match(source, /\\time 5\/8 r/);
});

test("a pickup, a bar with words, a bar in voices are never gathered", () => {
  const { score } = read("{ \\partial 4 r4 | R1*2 | r1^\"Solo\" | << { c''1 } \\\\ { r1 } >> | R1 | << { r1 } \\\\ { a'1 } >> }");
  score.compress = true;
  const source = engrave(score);
  assert.match(source, /\\partial 4\n\s+r4 \| R1\*2 \| r1\^"Solo" \| /);
  assert.match(source, /<< \{ r1 \} \\\\ \{ a'1 \} >>/);
});

test("kept: a \\compressMMRests the text wrote stays through an edit", () => {
  const src = "\\compressMMRests { c''1 | R1*4 | e''1 }";
  const { score, lost } = read(src);
  assert.equal(lost, undefined, "nothing to warn about");
  assert.equal(score.compress, true);
  // An edit elsewhere: the rests stay gathered.
  M.write(score, 0, M.barStart(score, 5), q, { rest: false, pitches: [{ d: 15, alter: 0 }] });
  const source = engrave(score);
  assert.match(source, /^\\compressMMRests \\new Staff/m);
  assert.match(source, /c''1 \| R1\*4 \| d''4 e''2\./);
  // A note written in the middle of the rests cuts the run in two.
  M.write(score, 0, M.barStart(score, 3), q, { rest: false, pitches: [{ d: 15, alter: 0 }] });
  assert.match(engrave(score), /c''1 \| R1\*2 \| d''4 r2\. \| R1 \|/);
  // The older spellings gather too, and are written as \compressMMRests.
  for (const old of ["{ \\compressEmptyMeasures R1*4 c'1 }", "{ \\set Score.skipBars = ##t R1*4 c'1 }", "{ \\compressFullBarRests R1*4 c'1 }"]) {
    const kept = read(old);
    assert.equal(kept.lost, undefined, old);
    assert.match(engrave(kept.score), /\\compressMMRests [^]*R1\*4 \| c'1/, old);
  }
});

test("a gathered run clicks as its first rest, and a jump on its last bar stays", () => {
  const { score } = read("{ \\segnoMark c''1 | R1*3 \\jump \"D.S.\" | c''1 }");
  score.compress = true;
  const { source, items } = M.toLilyPond(score);
  assert.match(source, /R1\*3 \\jump "D\.S\."/);
  assert.deepEqual(items.map((it) => it.index), [0, 1, 4]);
  engrave(score);
});

test("musicxml: a run of bars of rest goes out as <multiple-rest> and comes back gathered", async () => {
  const X = await import("../../public/eui-score/musicxml.js");
  const { score } = read("\\compressMMRests { c''1 | R1*5 | d''1 }");
  const xml = X.toMusicXML(score);
  assert.match(xml, /<measure-style><multiple-rest>5<\/multiple-rest><\/measure-style>/);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.match(source, /^\\compressMMRests /m);
  assert.match(engrave(read(source).score), /c''1 \| R1\*5 \| d''1/);
  // A score that gathers nothing says nothing of it.
  assert.doesNotMatch(X.toMusicXML(read("{ c''1 | R1*5 | d''1 }").score), /multiple-rest/);
});
