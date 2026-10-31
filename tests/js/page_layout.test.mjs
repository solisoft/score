// The page around the music (#388): headers and footers, odd and even pages,
// the systems a page, and the header's piece, opus and copyright — written
// in \paper as LilyPond reads them, read back from the text, kept through
// every edit, and accepted by the engraver the site ships (which draws them
// in the PDF once it reads them; until then it passes over them).
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, pdf, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** The text's score, as the editor opens it. */
function open(source) {
  const result = M.fromParsed(JSON.parse(score_json(source)), source);
  assert.ok(result.score, `reads: ${result.unsupported}`);
  return result;
}

/** The score's text, which the engraver must accept. */
function written(score) {
  const { source } = M.toLilyPond(score);
  JSON.parse(editor_view(source, 900, 7, -1, -1));
  return source;
}

test("headers, footers and the systems a page are written in \\paper and read back", () => {
  const s = M.fromTemplate("piano", { title: "Sonatina", composer: "Clementi", bars: 8 });
  M.setSystemsPerPage(s, "4");
  M.setPageLine(s, "oddHeader", "{title} | | {page}");
  M.setPageLine(s, "evenHeader", "{page} | {composer}");
  M.setPageLine(s, "oddFooter", "Page {page}");
  M.setPageLine(s, "evenFooter", "Practice copy | Page {page} |");
  const source = written(s);
  assert.match(source, /systems-per-page = 4/);
  assert.match(source, /oddHeaderMarkup = \\markup \\fill-line \{ \\fromproperty #'header:title "" \\fromproperty #'page:page-number-string \}/);
  assert.match(source, /evenHeaderMarkup = \\markup \\fill-line \{ \\fromproperty #'page:page-number-string \\fromproperty #'header:composer \}/);
  assert.match(source, /oddFooterMarkup = \\markup \\fill-line \{ \\concat \{ "Page " \\fromproperty #'page:page-number-string \} \}/);
  const back = open(source);
  assert.equal(back.score.paper.systemsPerPage, 4);
  assert.deepEqual(back.score.paper.marks, s.paper.marks);
  assert.equal(M.pageLineText(back.score.paper.marks.oddHeader), "{title} |  | {page}");
  assert.equal(M.pageLineText(back.score.paper.marks.oddFooter), "Page {page}");
  // Nothing the editor writes is said to be lost on the next edit.
  assert.deepEqual(back.lost ?? [], []);
  assert.deepEqual(M.passedOver(JSON.parse(score_json(source)).warnings), []);
  // Written again, the \paper is the same, and the text a fixed point from there.
  const again = M.toLilyPond(back.score).source;
  assert.equal(again.split("\n")[0], source.split("\n")[0]);
  assert.equal(M.toLilyPond(open(again).score).source, again);
});

test("an edit elsewhere keeps the page settings; clearing them writes nothing", () => {
  const s = M.fromTemplate("piano", { title: "Kept", bars: 4 });
  M.setPageLine(s, "oddFooter", "{title} | {page}");
  M.setSystemsPerPage(s, 2);
  const back = open(written(s)).score;
  M.setPaper(back, { size: "letter", staffSize: 18 });
  const after = written(back);
  assert.match(after, /set-paper-size "letter"/);
  assert.match(after, /systems-per-page = 2/);
  assert.match(after, /oddFooterMarkup/);
  M.setSystemsPerPage(back, "");
  M.setPageLine(back, "oddFooter", "  ");
  assert.equal(back.paper.marks, null);
  assert.equal(back.paper.systemsPerPage, null);
  assert.doesNotMatch(written(back), /systems-per-page|Markup/);
});

test("refuses a field a page does not print, four places, an unknown line and a count out of range", () => {
  const s = M.fromTemplate("piano", { title: "No", bars: 2 });
  const before = JSON.stringify(s.paper);
  assert.throws(() => M.setPageLine(s, "oddHeader", "{tempo}"), /\{tempo\} is not a field a page prints/);
  assert.throws(() => M.setPageLine(s, "oddHeader", "a | b | c | d"), /three places at most/);
  assert.throws(() => M.setPageLine(s, "middleHeader", "a"), /no such header or footer/);
  assert.throws(() => M.setPageLine(s, "oddHeader", "x".repeat(301)), /at most 300/);
  for (const bad of [21, -1, 2.5, "many"]) assert.throws(() => M.setSystemsPerPage(s, bad), /1 to 20/);
  assert.equal(JSON.stringify(s.paper), before, "nothing changed");
  // The bounds themselves are taken.
  M.setSystemsPerPage(s, 1);
  assert.equal(s.paper.systemsPerPage, 1);
  M.setSystemsPerPage(s, 20);
  assert.equal(s.paper.systemsPerPage, 20);
  M.setSystemsPerPage(s, 0);
  assert.equal(s.paper.systemsPerPage, null);
});

test("LilyPond's own headers are read; one the editor does not write is kept as written", () => {
  const source = `\\header { title = "T" }
\\paper {
  max-systems-per-page = 3
  oddHeaderMarkup = \\markup { \\fill-line { \\line { "Draft" \\fromproperty #'header:title } \\null } } % a comment
  evenFooterMarkup = \\markup \\fill-line { \\bold "Proof" \\on-the-fly #print-page-number-check-first \\fromproperty #'page:page-number-string }
  oddFooterMarkup = \\markup "Left alone"
}
{ c'1 }`;
  const { score } = open(source);
  assert.equal(score.paper.systemsPerPage, 3);
  assert.deepEqual(score.paper.marks.oddHeader, { cells: ["Draft {title}", ""] });
  assert.deepEqual(score.paper.marks.oddFooter, { cells: ["Left alone", "", ""] });
  assert.match(score.paper.marks.evenFooter.raw, /^\\markup \\fill-line \{ \\bold "Proof" .*page-number-string \}$/);
  const again = written(score);
  assert.ok(again.includes(score.paper.marks.evenFooter.raw), "the raw markup is written back as it was");
  assert.match(again, /systems-per-page = 3/);
  assert.deepEqual(open(again).score.paper.marks, score.paper.marks);
  // A text with no \paper, or one that says none of it: nothing.
  assert.deepEqual(M.readPage("{ c'1 }"), { systemsPerPage: null, marks: null });
  assert.deepEqual(M.readPage("\\paper { indent = 0 } { c'1 }"), { systemsPerPage: null, marks: null });
  assert.deepEqual(M.readPage(null), { systemsPerPage: null, marks: null });
  // A \\markup typed in the field is kept as such.
  const s = M.fromTemplate("piano", { title: "Raw", bars: 2 });
  M.setPageLine(s, "evenHeader", "\\markup \\italic \"Rehearsal\"");
  assert.match(written(s), /evenHeaderMarkup = \\markup \\italic "Rehearsal"/);
});

test("the header's piece, opus and copyright are written and read back", () => {
  const s = M.fromTemplate("piano", { title: "Sonatina", composer: "Clementi", bars: 2 });
  Object.assign(s.header, { piece: "Allegro", opus: "Op. 36, No. 1", copyright: "© 2026 Score" });
  const source = written(s);
  assert.match(source, /piece = "Allegro" opus = "Op\. 36, No\. 1" copyright = "© 2026 Score"/);
  const back = open(source).score;
  assert.equal(back.header.piece, "Allegro");
  assert.equal(back.header.opus, "Op. 36, No. 1");
  assert.equal(back.header.copyright, "© 2026 Score");
});

test("the PDF is made with the page settings, by any engraver; one that reads them prints their words as text", () => {
  const s = M.fromTemplate("piano", { title: "Sonatina", bars: 24 });
  s.header.copyright = "(c) 2026 Me";
  M.setPageLine(s, "oddFooter", "Practice copy | Page {page}");
  const pages = (doc) => (doc.match(/\/Type \/Page /g) ?? []).length;
  const free = pdf(written(s), "Sonatina");
  M.setSystemsPerPage(s, 1);
  const doc = pdf(written(s), "Sonatina");
  assert.match(doc, /^%PDF-1\.4/);
  assert.equal(pages(free), 1, "the piece fits a page");
  // The engraver of #388 on: invisible text with its characters mapped back, a system a page.
  if (doc.includes("/ToUnicode")) {
    assert.match(doc, /3 Tr/);
    assert.ok(pages(doc) >= 2, `a system a page: ${pages(doc)} pages`);
  }
});
