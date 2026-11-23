// A part laid out on its own (#1018): its line and page breaks, staff size,
// systems a page, spreading and space between systems are the part's alone,
// kept on the score's settings line under `parts`, by its staff's lane. The
// score's own layout is not touched, and its breaks are not the part's.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, pdf, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import { mergeScores } from "../../public/eui-score/merge.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const TRIO = `\\header { title = "Trio" } << \\new Staff \\with { instrumentName = "Flute" } { \\time 4/4 c''1 | d''1 | e''1 | f''1 | g''1 | a''1 | b''1 | c'''1 }
\\new Staff \\with { instrumentName = "Oboe" } { c'1 | R1 | R1 | R1 | R1 | R1 | R1 | c'1 }
\\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 | e1 | f1 | g1 | a1 | b1 | c1 } >>`;

/** A text read as the studio reads it: the model, its settings line on it. */
function open(text = TRIO) {
  const { score } = M.fromParsed(JSON.parse(score_json(text)), text);
  assert.ok(score, "reads");
  M.attachMeta(score, text);
  return score;
}

/** The score's text, which the engraver must accept. */
function written(score) {
  const { source } = M.toLilyPond(score);
  JSON.parse(editor_view(source, 900, 7, -1, -1));
  return source;
}

/** The text of the part of staff `lane`, as its player reads it; the engraver must accept it. */
function part(score, lane) {
  const { source } = M.toLilyPond(M.partOf(score, lane), { written: true });
  JSON.parse(editor_view(source, 900, 7, -1, -1));
  return source;
}

const breaksIn = (text) => (text.match(/\\(break|pageBreak)\b/g) ?? []).join(" ");
const pages = (text) => (Buffer.from(pdf(text, "t")).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;

test("a part's break is in that part's text alone: not in the score's, not in another part's", () => {
  const score = open();
  M.setPartBreak(score, 0, 1, "line");
  M.setPartBreak(score, 0, 3, "page");
  assert.deepEqual(score.meta.parts, { 0: { breaks: { 1: "line", 3: "page" } } });
  assert.equal(breaksIn(part(score, 0)), "\\break \\pageBreak");
  assert.match(part(score, 0), /d''1 \|\s+\\break e''1/);
  assert.equal(breaksIn(part(score, 2)), "", "the bass's part has none");
  const text = written(score);
  assert.equal(breaksIn(text), "", "the score's music has none");
  assert.deepEqual(score.breaks ?? {}, {});
  // Kept on the settings line, and read back with the text.
  assert.match(text, /\n%% eui-score \{"parts":\{"0":\{"breaks":\{"1":"line","3":"page"\}\}\}\}\n$/);
  assert.deepEqual(M.partLayout(open(text), 0).breaks, { 1: "line", 3: "page" });
  // The page break is one in the PDF.
  assert.equal(pages(part(score, 2)), 1);
  assert.equal(pages(part(score, 0)), 2);
  // Taken away again, the part's setting goes, and the key with the last one.
  M.setPartBreak(score, 0, 1, null);
  M.setPartBreak(score, 0, 3, null);
  assert.equal(score.meta.parts, undefined);
  assert.doesNotMatch(written(score), /eui-score/);
});

test("the score's breaks are the score's: a part has none of them", () => {
  const score = open();
  M.setBreak(score, 3, "line");
  assert.equal(breaksIn(written(score)), "\\break");
  for (const lane of [0, 1, 2]) assert.equal(breaksIn(part(score, lane)), "", `part ${lane}`);
  M.setPartBreak(score, 2, 5, "line");
  assert.equal(breaksIn(written(score)), "\\break", "the score keeps its one break");
  assert.match(part(score, 2), /a1 \|\s+\\break b1/);
  assert.doesNotMatch(part(score, 2), /f1 \|\s+\\break/);
});

test("a part's staff size, systems a page, spreading and spacing are in its text alone; the paper stays the score's", () => {
  const score = open();
  M.setPaper(score, { size: "letter", staffSize: 18 });
  M.setSystemsPerPage(score, 6);
  M.setPartLayout(score, 2, { staffSize: 22, systemsPerPage: 3, evenPages: true, systemSpacing: 16 });
  assert.deepEqual(score.meta.parts, { 2: { staffSize: 22, systemsPerPage: 3, evenPages: true, systemSpacing: 16 } });
  const bass = part(score, 2);
  assert.match(bass, /#\(set-global-staff-size 22\)/);
  assert.match(bass, /\\paper \{ #\(set-paper-size "letter"\) page-breaking = #ly:optimal-breaking systems-per-page = 3 system-system-spacing\.basic-distance = #16 \}/);
  // The score, and the flute's part, are laid out as the score says.
  for (const text of [written(score), part(score, 0)]) {
    assert.match(text, /#\(set-global-staff-size 18\)/);
    assert.match(text, /\\paper \{ #\(set-paper-size "letter"\) systems-per-page = 6 \}/);
  }
  assert.deepEqual(M.partLayout(score, 2), { breaks: {}, staffSize: 22, systemsPerPage: 3, evenPages: true, systemSpacing: 16 });
  assert.deepEqual(M.partLayout(score, 0), { breaks: {}, staffSize: null, systemsPerPage: null, evenPages: null, systemSpacing: null });
  // The spacing is drawn: the PDF differs with it.
  const before = Buffer.from(pdf(bass, "t")).toString("latin1");
  M.setPartBreak(score, 2, 3, "line");
  M.setPartLayout(score, 2, { systemSpacing: 30 });
  const wide = Buffer.from(pdf(part(score, 2), "t")).toString("latin1");
  M.setPartLayout(score, 2, { systemSpacing: 8 });
  assert.notEqual(Buffer.from(pdf(part(score, 2), "t")).toString("latin1"), wide);
  assert.notEqual(before, wide);
  // One setting given back to the score; the others stay.
  M.setPartLayout(score, 2, { staffSize: "", systemsPerPage: 0, evenPages: null, systemSpacing: null });
  assert.deepEqual(score.meta.parts, { 2: { breaks: { 3: "line" } } });
  assert.match(part(score, 2), /#\(set-global-staff-size 18\)/);
  // A part that fills its pages in turn where the score spreads them.
  M.setEvenPages(score, true);
  assert.match(part(score, 2), /optimal-breaking/);
  M.setPartLayout(score, 2, { evenPages: false });
  assert.doesNotMatch(part(score, 2), /page-breaking/);
  assert.match(written(score), /optimal-breaking/);
  // The usual size, in a score of another: said by leaving it out.
  M.setPartLayout(score, 2, { staffSize: 20 });
  assert.doesNotMatch(part(score, 2), /set-global-staff-size/);
});

test("a part's text carries no part layout: the setting has done its work", () => {
  const score = open();
  M.setPartBreak(score, 0, 1, "line");
  M.setPartLayout(score, 2, { staffSize: 16 });
  score.meta.mixer = { tracks: { 0: { mute: true }, 2: { volume: 0.5 } } };
  const flute = part(score, 0);
  assert.doesNotMatch(flute, /"parts"/);
  assert.match(flute, /%% eui-score \{"mixer":\{"tracks":\{"0":\{"mute":true\}\}\}\}/);
  assert.doesNotMatch(part(score, 1), /eui-score/);
  // The score is as it was.
  assert.deepEqual(Object.keys(score.meta.parts), ["0", "2"]);
});

test("a part's breaks follow their bars: bars put in before them, and taken away", () => {
  const score = open();
  M.setPartBreak(score, 0, 1, "line");
  M.setPartBreak(score, 0, 5, "page");
  M.setPartBreak(score, 2, 3, "line");
  M.insertBars(score, 2, 2);
  assert.deepEqual(score.meta.parts, { 0: { breaks: { 1: "line", 7: "page" } }, 2: { breaks: { 5: "line" } } });
  assert.match(part(score, 2), /f1 \|\s+\\break g1/, "still after the same bar's music");
  M.deleteBars(score, 2, 3);
  assert.deepEqual(score.meta.parts, { 0: { breaks: { 1: "line", 5: "page" } }, 2: { breaks: { 3: "line" } } });
  // A break after a bar that goes, goes with it; a part left with nothing is not kept.
  M.deleteBars(score, 3, 3);
  assert.deepEqual(score.meta.parts, { 0: { breaks: { 1: "line", 4: "page" } } });
  M.setPartLayout(score, 0, { staffSize: 16 });
  M.deleteBars(score, 1, 4);
  assert.deepEqual(score.meta.parts, { 0: { staffSize: 16 } });
});

test("a part's layout follows its staff: a staff added before it, or taken away", () => {
  const score = open();
  M.setPartBreak(score, 2, 3, "line");
  M.setPartLayout(score, 2, { staffSize: 16 });
  M.addChordStaff(score, 0);
  assert.deepEqual(Object.keys(score.meta.parts), ["3"]);
  assert.match(part(score, 3), /\\clef bass[^]*\\break/);
  M.removeStaff(score, 0);
  M.removeStaff(score, 0);
  assert.deepEqual(score.meta.parts, { 1: { breaks: { 3: "line" }, staffSize: 16 } });
  assert.match(part(score, 1), /#\(set-global-staff-size 16\)[^]*\\clef bass[^]*f1 \|\s+\\break g1/);
  M.removeStaff(score, 1);
  assert.equal(score.meta.parts, undefined, "gone with its staff");
});

test("a break inside a part's bars of rest splits them: R1*6 is R1*2, the break, R1*4", () => {
  const score = open();
  assert.match(part(score, 1), /R1\*6/);
  M.setPartBreak(score, 1, 2, "line");
  const oboe = part(score, 1);
  assert.match(oboe, /R1\*2 \|?\s*\\break R1\*4/);
  assert.doesNotMatch(oboe, /R1\*6/);
});

test("a note changed in the score is changed in the part, whose layout is kept — through the text too", () => {
  const score = open();
  M.setPartBreak(score, 0, 1, "line");
  M.setPartLayout(score, 0, { staffSize: 24, systemsPerPage: 2 });
  const text = written(score);
  const edited = open(text.replace("e''1", "ees''1"));
  const flute = part(edited, 0);
  assert.match(flute, /d''1 \|\s+\\break es''1/);
  assert.match(flute, /#\(set-global-staff-size 24\)/);
  assert.match(flute, /systems-per-page = 2/);
  assert.deepEqual(edited.meta.parts, score.meta.parts);
  assert.equal(M.toLilyPond(open(written(edited))).source, written(edited), "a fixed point");
});

test("what cannot be is refused, and nothing is written", () => {
  const score = open();
  const refused = (fn, said) => {
    assert.throws(fn, said);
    assert.equal(score.meta?.parts, undefined);
  };
  refused(() => M.setPartBreak(score, 0, 7, "line"), /a break goes after a bar, before the last one ends/);
  refused(() => M.setPartBreak(score, 0, -1, "line"), /a break goes after a bar/);
  refused(() => M.setPartBreak(score, 0, 1.5, "line"), /a break goes after a bar/);
  refused(() => M.setPartBreak(score, 0, NaN, "line"), /a break goes after a bar/);
  refused(() => M.setPartBreak(score, 0, 1, "column"), /a break is a line's or a page's/);
  refused(() => M.setPartBreak(score, 3, 1, "line"), /no such staff/);
  refused(() => M.setPartBreak(score, "x", 1, "line"), /no such staff/);
  refused(() => M.setPartLayout(score, 9, { staffSize: 20 }), /no such staff/);
  refused(() => M.resetPartLayout(score, 9), /no such staff/);
  refused(() => M.setPartLayout(score, 0, { staffSize: 10 }), /a staff size is 11 to 26 points/);
  refused(() => M.setPartLayout(score, 0, { staffSize: 27 }), /a staff size is 11 to 26 points/);
  refused(() => M.setPartLayout(score, 0, { staffSize: "big" }), /a staff size is 11 to 26 points/);
  refused(() => M.setPartLayout(score, 0, { systemsPerPage: 21 }), /systems a page: 1 to 20/);
  refused(() => M.setPartLayout(score, 0, { systemsPerPage: 2.5 }), /systems a page/);
  refused(() => M.setPartLayout(score, 0, { systemsPerPage: -1 }), /systems a page/);
  refused(() => M.setPartLayout(score, 0, { evenPages: "yes" }), /spreading the lines is on or off/);
  refused(() => M.setPartLayout(score, 0, { systemSpacing: 5 }), /the space between systems is 6 to 40 staff spaces/);
  refused(() => M.setPartLayout(score, 0, { systemSpacing: 41 }), /the space between systems is 6 to 40/);
  // One bad value among good ones: none of them is written.
  refused(() => M.setPartLayout(score, 0, { staffSize: 16, systemSpacing: 99 }), /the space between systems/);
  // The limits themselves are taken.
  M.setPartBreak(score, 0, 6, "page");
  M.setPartLayout(score, 0, { staffSize: 11, systemsPerPage: 20, systemSpacing: 40 });
  M.setPartLayout(score, 0, { staffSize: 26, systemsPerPage: 1, systemSpacing: 6 });
  assert.deepEqual(score.meta.parts, { 0: { breaks: { 6: "page" }, staffSize: 26, systemsPerPage: 1, systemSpacing: 6 } });
  // A lower voice's lane is no part's.
  M.addVoice(score, 0, 2);
  assert.throws(() => M.setPartBreak(score, 1, 1, "line"), /no such staff/);
});

test("Reset to the score's layout takes the part's own away, the other parts' kept", () => {
  const score = open();
  M.setPartBreak(score, 0, 1, "line");
  M.setPartLayout(score, 0, { staffSize: 16 });
  M.setPartBreak(score, 2, 1, "page");
  M.resetPartLayout(score, 0);
  assert.deepEqual(score.meta.parts, { 2: { breaks: { 1: "page" } } });
  assert.equal(breaksIn(part(score, 0)), "");
  M.resetPartLayout(score, 2);
  assert.equal(score.meta.parts, undefined);
});

test("a settings line written by hand: what does not fit a part's layout is left out, and said", () => {
  const line = {
    parts: {
      0: { breaks: { 1: "line", 2: "column", x: "page", "-1": "line" }, staffSize: 99, systemsPerPage: 3, evenPages: "yes", systemSpacing: 14, more: 1 },
      1: { staffSize: "20" },
      2: "big",
      "audio-1": { staffSize: 16 },
    },
  };
  const read = M.readMetaLines(`{ c'1 }\n%% eui-score ${JSON.stringify(line)}\n`);
  assert.deepEqual(read.meta, { parts: { 0: { breaks: { 1: "line" }, systemsPerPage: 3, systemSpacing: 14 } } });
  assert.deepEqual(read.dropped, ["Part layouts"]);
  // Nothing of it fits: the key goes.
  assert.deepEqual(M.readMetaLines(`{ c'1 }\n%% eui-score {"parts":[1]}\n`).meta, {});
  assert.deepEqual(M.readMetaLines(`{ c'1 }\n%% eui-score {"parts":{"0":{"staffSize":3}}}\n`).meta, {});
  // One that fits reads whole, and nothing is said.
  const good = M.readMetaLines(`{ c'1 }\n%% eui-score {"parts":{"0":{"breaks":{"1":"page"},"evenPages":false}}}\n`);
  assert.deepEqual(good.meta, { parts: { 0: { breaks: { 1: "page" }, evenPages: false } } });
  assert.deepEqual(good.dropped, []);
  // A malformed layout on the model itself (set by another program) lays the part out with what fits.
  const score = open();
  score.meta = { parts: { 0: { breaks: { 1: "line", 2: "sideways" }, staffSize: 300 } } };
  assert.equal(breaksIn(part(score, 0)), "\\break");
  assert.doesNotMatch(part(score, 0), /set-global-staff-size/);
  M.setPartBreak(score, 0, 4, "page");
  assert.deepEqual(score.meta.parts, { 0: { breaks: { 1: "line", 4: "page" } } }, "an edit cleans what it rewrites");
});

test("a merge: a part's layout set on one side goes with its staff and its bars on the other", () => {
  const canon = (text, change) => {
    const score = open(text);
    change?.(score);
    return M.toLilyPond(score).source;
  };
  const base = canon(TRIO);
  // Mine: the bass's part gets a break after its sixth bar and a size.
  const mine = canon(TRIO, (score) => {
    M.setPartBreak(score, 2, 5, "line");
    M.setPartLayout(score, 2, { staffSize: 16 });
  });
  // Theirs: the oboe is taken away — the bass is the second staff once merged.
  const fewer = mergeScores(base, mine, canon(TRIO, (score) => M.removeStaff(score, 1)), { parse: score_json });
  assert.deepEqual(fewer.conflicts, []);
  assert.deepEqual(M.readMeta(fewer.text).parts, { 1: { staffSize: 16, breaks: { 5: "line" } } });
  // Theirs: two bars put in at the start — the break is after the same bar's music, two bars on.
  const out = mergeScores(base, mine, canon(TRIO, (score) => M.insertBars(score, 0, 2)), { parse: score_json });
  assert.deepEqual(out.conflicts, []);
  assert.deepEqual(M.readMeta(out.text).parts, { 2: { staffSize: 16, breaks: { 7: "line" } } });
  assert.match(part(open(out.text), 2), /a1 \|\s+\\break b1/);
  // The break's bar taken away on the other side, where the break was set already: it goes with its bar, the size stays.
  const cut = mergeScores(mine, mine, canon(mine, (score) => M.deleteBars(score, 5, 5)), { parse: score_json });
  assert.deepEqual(cut.conflicts, []);
  assert.deepEqual(M.readMeta(cut.text).parts, { 2: { staffSize: 16 } });
  // Set on one side in a bar the other takes away: said, as for a curve there — nothing is merged silently.
  const clash = mergeScores(base, mine, canon(TRIO, (score) => M.deleteBars(score, 5, 5)), { parse: score_json });
  assert.equal(clash.text, null);
  assert.equal(clash.whole, true);
});
