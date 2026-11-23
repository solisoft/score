// Margins and spacing (#1025): the page's four margins and the first
// system's indent (mm), the spaces between systems, between the staves of a
// system and from the title to the music (staff spaces) — written in \paper
// and \layout as LilyPond reads them, read back from the text, each empty
// for the default; refused out of range or when the margins leave the music
// too little of the page, nothing changed then. The engraver the site ships
// (eui 2bdc942) accepts them all and draws the spaces.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { check, score_json, source_spans, svg } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** The engraver's reading of a text, with where each note is written, as the studio asks for it. */
function withSpans(text) {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return parsed;
}

/** The text's score, as the editor opens it: nothing passed over. */
function open(source) {
  const result = M.fromParsed(withSpans(source), source, { parse: withSpans });
  assert.ok(result.score, `reads: ${result.unsupported}`);
  assert.equal(result.lost, undefined, `nothing lost: ${result.lost}`);
  return result.score;
}

const DUO = "\\header { title = \"Duo\" }\n<<\n  \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''1 | c''1 }\n"
  + "  \\new Staff { \\clef bass c4 d e f | g1 | c1 }\n>>\n";

/** How tall the engraver draws `source`, in px. */
const drawnHeight = (source) => Number(/viewBox="[-\d.]+ [-\d.]+ [\d.]+ ([\d.]+)"/.exec(svg(source, 600, 6, "{}"))[1]);

test("margins, indent and spaces: written in \\paper and \\layout, accepted by the engraver, read back the same", () => {
  const score = open(DUO);
  M.setPageSpacing(score, { top: "20", bottom: 15, left: "25", right: "25", indent: "0", systems: "18", staves: "14", title: "12,5" });
  const { source } = M.toLilyPond(score);
  assert.match(source, /^\\paper \{ left-margin = 25\\mm right-margin = 25\\mm top-margin = 20\\mm bottom-margin = 15\\mm indent = 0\\mm system-system-spacing\.basic-distance = #18 markup-system-spacing\.basic-distance = #12\.5 \}\n/);
  assert.match(source, /\n\\layout \{ \\context \{ \\Staff \\override VerticalAxisGroup\.staff-staff-spacing = #'\(\(basic-distance \. 14\) \(minimum-distance \. 8\) \(padding \. 1\) \(stretchability \. 5\)\) \} \}\n/);
  assert.equal(check(source), "", "the engraver of the day takes them");
  const again = open(source);
  assert.deepEqual(M.pageSpacing(again), { top: 20, bottom: 15, left: 25, right: 25, indent: 0, systems: 18, staves: 14, title: 12.5 });
  assert.equal(M.toLilyPond(again).source, source, "written back to the letter");
  // A space under the staff spaces of a default staff: its minimum distance is that space too.
  M.setPageSpacing(again, { staves: 6 });
  assert.match(M.toLilyPond(again).source, /\(basic-distance \. 6\) \(minimum-distance \. 6\)/);
});

test("each empty is the default: nothing written, the text as it was; a field left out stays as it is", () => {
  const score = open(DUO);
  const before = M.toLilyPond(score).source;
  assert.deepEqual(M.pageSpacing(score), { top: null, bottom: null, left: null, right: null, indent: null, systems: null, staves: null, title: null });
  M.setPageSpacing(score, { left: 30, systems: 20, staves: 12 });
  M.setPageSpacing(score, { systems: "16" });
  assert.deepEqual(M.pageSpacing(score), { top: null, bottom: null, left: 30, right: null, indent: null, systems: 16, staves: 12, title: null });
  M.setPageSpacing(score, { left: "", systems: null, staves: " " });
  assert.equal(M.toLilyPond(score).source, before);
  assert.equal(score.layout, undefined);
  assert.equal(score.paper.more, undefined);
});

test("the engraver draws the spaces: a system further from the next, staves further apart, the title further from the music", () => {
  const score = open(DUO);
  const base = drawnHeight(M.toLilyPond(score).source);
  for (const [field, value] of [["staves", 20], ["title", 20]]) {
    const one = open(DUO);
    M.setPageSpacing(one, { [field]: value });
    assert.ok(drawnHeight(M.toLilyPond(one).source) > base + 20, `${field} drawn`);
  }
  const long = open(DUO.replace("c''1 }", `${"c''1 | ".repeat(30)}c''1 }`).replace("c1 }", `${"c1 | ".repeat(30)}c1 }`));
  const longBase = drawnHeight(M.toLilyPond(long).source);
  M.setPageSpacing(long, { systems: 30 });
  assert.ok(drawnHeight(M.toLilyPond(long).source) > longBase + 40, "systems drawn further apart");
});

test("refused, said, and nothing changes: out of range, not a number, margins that leave the music too little", () => {
  const score = open(DUO);
  M.setPageSpacing(score, { left: 12 });
  const refused = (values, pattern) => {
    const was = JSON.stringify(score);
    assert.throws(() => M.setPageSpacing(score, values), pattern, JSON.stringify(values));
    assert.equal(JSON.stringify(score), was, `nothing changed: ${JSON.stringify(values)}`);
  };
  refused({ top: "-1" }, /The top margin is 0 to 60 mm/);
  refused({ bottom: 61 }, /The bottom margin is 0 to 60 mm/);
  refused({ right: "abc" }, /The right margin: a number of millimetres/);
  refused({ indent: 81 }, /The first system's indent is 0 to 80 mm/);
  refused({ systems: 5 }, /The space between systems is 6 to 40 staff spaces/);
  refused({ staves: 41 }, /The space between the staves of a system is 4 to 40 staff spaces/);
  refused({ title: "1.2.3" }, /The space between the title and the music: a number of staff spaces/);
  // A good value beside a bad one is not set either.
  refused({ left: 20, title: -3 }, /The space between the title and the music is 0 to 40/);
  // A4 is 210 mm across: 60 + 60 + 15 leave 75.
  refused({ left: 60, right: 60 }, /leave the music 75 mm across the page: keep at least 80 mm/);
  // On A5 (148 mm) what fits on A4 does not; in landscape, down the page is shorter.
  M.setPaper(score, { size: "a5" });
  refused({ left: 25, right: 25, indent: 20 }, /leave the music 78 mm across/);
  M.setPaper(score, { size: "a5landscape" });
  refused({ top: 30, bottom: 20 }, /The top and bottom margins leave the music 98 mm down the page/);
  M.setPaper(score, { size: "a4landscape" });
  refused({ top: 60, bottom: 60 }, /The top and bottom margins leave the music 90 mm down the page: keep at least 100 mm/);
});

test("LilyPond's own forms are read: a whole alist, a key of it; what the alist says beside is kept", () => {
  // A key of an alist in \paper, written as LilyPond writes it, read and written back as it is (#1025: it was split in two).
  const keyed = "\\paper { system-system-spacing.basic-distance = #14 top-margin = 8\\mm }\n" + DUO;
  const score = open(keyed);
  assert.deepEqual([M.pageSpacing(score).systems, M.pageSpacing(score).top], [14, 8]);
  assert.match(M.toLilyPond(score).source, /^\\paper \{ top-margin = 8\\mm system-system-spacing\.basic-distance = #14 \}/);
  // A whole alist: its distance shown; a new one set after it, the alist's padding kept; empty, the alist's again.
  const whole = open("\\paper { system-system-spacing = #'((basic-distance . 15) (padding . 2)) }\n" + DUO);
  assert.equal(M.pageSpacing(whole).systems, 15);
  M.setPageSpacing(whole, { systems: 20 });
  const { source } = M.toLilyPond(whole);
  assert.match(source, /^\\paper \{ system-system-spacing = #'\(\(basic-distance \. 15\) \(padding \. 2\)\) system-system-spacing\.basic-distance = #20 \}/);
  assert.equal(check(source), "");
  assert.equal(M.pageSpacing(open(source)).systems, 20);
  M.setPageSpacing(whole, { systems: "" });
  assert.equal(M.pageSpacing(whole).systems, 15);
  // A \layout block of the text's own is kept beside the editor's.
  const own = open("\\layout { indent = 0 }\n" + DUO);
  M.setPageSpacing(own, { staves: 12 });
  assert.equal(own.layout.length, 2);
  M.setPageSpacing(own, { staves: "" });
  assert.deepEqual(own.layout, ["\\layout { indent = 0 }"]);
});

test("a desk's or a staff's part keeps the score's margins; its own space between systems wins over the score's", () => {
  const score = open(DUO);
  M.setPageSpacing(score, { left: 20, systems: 14 });
  M.setPartLayout(score, 0, { systemSpacing: 24 });
  const part = M.toLilyPond(M.partOf(score, 0), { written: true }).source;
  assert.match(part, /left-margin = 20\\mm/);
  assert.match(part, /system-system-spacing\.basic-distance = #24/);
  assert.doesNotMatch(part, /basic-distance = #14/);
  assert.equal(check(part), "");
});
