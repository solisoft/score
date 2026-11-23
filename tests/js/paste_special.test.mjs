// Paste special (#1024): what was copied pasted in part. The notes only,
// without their marks; the rhythm only, on the pitches already there (a
// tied note one pitch); the marks only — dynamics, hairpins, articulations,
// slurs and words sung — on the notes already there that start where the
// copied ones did. Bars copied over several staves paste so on each. What
// cannot be pasted is refused.
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
    const name = ev.rest ? "r" : M.spellPitch(ev.pitches[0].d, ev.pitches[0].alter);
    return `${name}${ev.base}${".".repeat(ev.dots)}${ev.tie ? "~" : ""}`;
  }).join(" ");
}
const bar = (score, b) => M.barStart(score, b);
const marks = (ev) => [ev.dynamic, ev.arts.join(","), ev.slurStart ? "(" : "", ev.slurEnd ? ")" : "", ev.lyric?.text ?? ""].join("|");

test("the notes only: pitches and lengths, no dynamic, articulation or slur", () => {
  const score = open(`{ c'4\\f-. d'4( e'4) f'4 | r1 }`);
  const clip = M.copy(score, 0, 0, 3);
  T.pasteSpecial(score, 0, bar(score, 1), clip, "notes");
  assert.equal(written(score), "c'4 d'4 e'4 f'4 c'4 d'4 e'4 f'4");
  for (const ev of score.staves[0].events.slice(4)) assert.equal(marks(ev), "||||");
  assert.equal(score.staves[0].events[0].dynamic, "f", "the copy is as it was");
});

test("the rhythm only: the copied lengths on the pitches there, the last kept when they run out", () => {
  const score = open(`{ c'8 c'8 c'4 r2 | e'2 g'2 }`);
  T.pasteSpecial(score, 0, bar(score, 1), M.copy(score, 0, 0, 3), "rhythm");
  assert.equal(written(score).split(" ").slice(4).join(" "), "e'8 g'8 g'4 r2");
});

test("the rhythm only: a tied note takes one pitch, and the copy's marks stay behind", () => {
  const score = open(`{ c'2\\p~ c'4 c'4-> | d'4 e'4 f'2 }`);
  T.pasteSpecial(score, 0, bar(score, 1), M.copy(score, 0, 0, 2), "rhythm");
  assert.equal(written(score).split(" ").slice(3).join(" "), "d'2~ d'4 e'4");
  for (const ev of score.staves[0].events.slice(3)) assert.equal(marks(ev), "||||");
});

test("the marks only: on the notes starting where the copied ones did, the pitches and rhythm left", () => {
  const score = open(`{ c'2\\f( d'2-.) | g'4 a'4 b'2 }`);
  T.pasteSpecial(score, 0, bar(score, 1), M.copy(score, 0, 0, 1), "marks");
  assert.equal(written(score), "c'2 d'2 g'4 a'4 b'2");
  const [g, a, b] = score.staves[0].events.slice(2);
  assert.equal(marks(g), "f||(||");
  assert.equal(marks(a), "||||");
  assert.equal(marks(b), "|staccato||)|");
});

test("the marks only: the words sung go onto the notes there", () => {
  const score = open(`<< \\new Staff { \\new Voice = "v" { c'4 d'4 e'2 | g'4 a'4 b'2 } } \\new Lyrics \\lyricsto "v" { la li lo } >>`);
  T.pasteSpecial(score, 0, bar(score, 1), M.copy(score, 0, 0, 2), "marks");
  assert.deepEqual(score.staves[0].events.slice(3).map((ev) => ev.lyric?.text), ["la", "li", "lo"]);
});

test("bars of two staves, the notes only: each staff's on its own", () => {
  const score = open(`<< \\new Staff { c''4\\ff d''2. | r1 } \\new Staff { \\clef bass c1-> | r1 } >>`);
  const section = M.copySection(score, [0, 1], 0, 0);
  T.pasteSpecial(score, 0, bar(score, 1), { section }, "notes");
  assert.equal(written(score, 0), "c''4 d''2. c''4 d''2.");
  assert.equal(written(score, 1), "c1 c1");
  assert.equal(score.staves[0].events[2].dynamic, null);
  assert.deepEqual(score.staves[1].events[1].arts, []);
});

test("refused: the rhythm where there is no note to take a pitch from, marks where no note starts, another kind", () => {
  const score = open(`{ c'4 d'4 e'2 | r1 }`);
  const clip = M.copy(score, 0, 0, 2);
  assert.throws(() => T.pasteSpecial(score, 0, bar(score, 1), clip, "rhythm"), /no note/);
  const marked = open(`{ c'4-> d'4 e'2 | r1 }`);
  assert.throws(() => T.pasteSpecial(marked, 0, bar(marked, 1), M.copy(marked, 0, 0, 2), "marks"), /no note/);
  assert.throws(() => T.pasteSpecial(score, 0, 0, clip, "colours"), /[Pp]aste/);
});

test("Ctrl+Alt+Shift+V opens paste special; Ctrl+V and Ctrl+Shift+V are as they were", async () => {
  const { resolveKey } = await import("../../public/eui-score/shortcuts.js");
  const key = (k, more) => ({ key: k, code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...more });
  assert.deepEqual(resolveKey(key("V", { ctrlKey: true, altKey: true, shiftKey: true })), ["paste-special", {}]);
  // On a Mac, ⌥⇧V types another letter: its code stays.
  assert.deepEqual(resolveKey(key("◊", { metaKey: true, altKey: true, shiftKey: true, code: "KeyV" })), ["paste-special", {}]);
  assert.deepEqual(resolveKey(key("v", { ctrlKey: true })), ["paste", {}]);
  assert.deepEqual(resolveKey(key("V", { ctrlKey: true, shiftKey: true })), ["insert-copied", {}]);
});
