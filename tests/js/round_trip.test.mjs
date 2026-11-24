// Nothing the engraver reads is lost in silence (#1039).
//
// The engraver had learned signs the score editor never followed: opened
// in the editor, an arpeggio's bracket became a wavy line, a tremolo
// between two notes two plain notes, a sostenuto pedal a line of words —
// with no word said. This is the net under that.
//
// Every construct the engraver reads is opened, written back from the
// model, and both texts are asked what the engraver reads in them
// (`reading`, wasm/src/reading.rs: every field of the engraver's event,
// named one by one) and played (`midi`). Each piece must either
//
//   - come back with every sign and the same sound, or
//   - be declared: left to the text (`unsupported`), or named before the
//     first rewrite (`lost`, with what `unkept` finds).
//
// The pieces that are declared are listed here, by name: one more is a
// regression, and one fewer is a line to take out.
//
//   node --test tests/js/round_trip.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import init, { midi, reading, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import { PIECES, SCRIPT_NAMES } from "./fixtures/signs_1039.mjs";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

function withSpans(text) {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return parsed;
}

const sound = (text) => Buffer.from(midi(text, 120, 4, 0)).toString("hex");

/**
 * A text through the editor, as the studio opens it (studio-text.js): what
 * came of it — "kept" (every sign, the same sound), "said" (the page names
 * what the rewrite leaves out), "text" (left to the text) — and the details.
 */
function through(src) {
  const opened = M.fromParsed(withSpans(src), src, { parse: withSpans });
  if (!opened.score) return { how: "text", why: opened.unsupported };
  const out = M.toLilyPond(opened.score).source;
  const declared = [...(opened.lost ?? []), ...M.unkept(opened.score, src, reading)];
  let gone;
  try {
    gone = M.signsLost(JSON.parse(reading(src)), JSON.parse(reading(out)));
  } catch (error) {
    return { how: declared.length ? "said" : "LOST", why: declared, out, gone: [{ where: "piece", sign: `the rewrite is refused: ${error.message ?? error}`, times: 1 }] };
  }
  const heard = sound(src) === sound(out);
  if (!gone.length && heard) return { how: "kept", why: declared, out, score: opened.score };
  return { how: declared.length ? "said" : "LOST", why: declared, out, gone, heard, score: opened.score };
}

const show = (r) => `${(r.gone ?? []).map((g) => `${g.where}: ${g.sign} ×${g.times}`).join("\n")}${r.heard === false ? "\n(it sounds different)" : ""}\n${r.out ?? ""}`;

// The pieces of the corpus the editor does not keep whole, and says so.
const SAID = {
  // A tempo with no note after it draws nothing; the model keeps a tempo on the bar it starts.
  "a tempo after the last note": /a clef, a key, a metre or a mark/,
};
const TEXT = {};

test("every sign of the corpus comes back from the editor, or the page says which does not", () => {
  const seen = { kept: [], said: [], text: [] };
  for (const [name, src] of Object.entries(PIECES)) {
    const r = through(src);
    assert.notEqual(r.how, "LOST", `${name}: lost in silence\n${show(r)}`);
    seen[r.how].push(name);
    if (r.how === "said") {
      assert.ok(SAID[name], `${name} came back whole before; now the page says it does not keep ${r.why.join(", ")}\n${show(r)}`);
      assert.match(r.why.join(", "), SAID[name], name);
    } else if (r.how === "text") {
      assert.ok(TEXT[name], `${name} opened in the editor before; now it is left to the text: ${r.why.join(", ")}`);
      assert.match(r.why.join(", "), TEXT[name], name);
    } else {
      assert.ok(!SAID[name] && !TEXT[name], `${name} comes back whole now: take it out of the list of what does not`);
      assert.deepEqual(r.why, [], `${name}: nothing is said to be lost when nothing is`);
    }
  }
  assert.equal(seen.kept.length, Object.keys(PIECES).length - Object.keys(SAID).length - Object.keys(TEXT).length);
});

test("what the editor wrote reads back as the same score, and loses nothing a second time", () => {
  for (const [name, src] of Object.entries(PIECES)) {
    const first = through(src);
    if (!first.score) continue;
    const again = M.fromParsed(withSpans(first.out), first.out, { parse: withSpans });
    assert.ok(again.score, `${name}: the editor's own text opens in the editor (${again.unsupported})\n${first.out}`);
    assert.deepEqual(again.lost ?? [], [], `${name}: the editor's own text holds only what it keeps\n${first.out}`);
    assert.deepEqual(M.unkept(again.score, first.out, reading), [], `${name}\n${first.out}`);
    assert.equal(M.toLilyPond(again.score).source, first.out, `${name}: written twice, the same text`);
  }
});

test("each of LilyPond's scripts is one the editor keeps, over, under and where the engraver puts it", () => {
  for (const name of SCRIPT_NAMES) {
    const src = `{ \\time 4/4 c''4\\${name} d''_\\${name} e''^\\${name} f'' }`;
    const r = through(src);
    assert.equal(r.how, "kept", `\\${name}\n${show(r)}`);
    const [a, b, c] = r.score.staves[0].events;
    assert.ok(a.arts.includes(name) && b.arts.includes(name) && c.arts.includes(name), name);
    assert.equal(b.artDirs?.[name], 1, `_\\${name}`);
    assert.equal(c.artDirs?.[name], -1, `^\\${name}`);
    assert.ok(Object.values(M.ARTICULATION_FAMILIES).flat().includes(name) || ["open", "stopped"].includes(name), `${name} is in a family the tools offer`);
  }
  // …and the tools offer nothing the engraver refuses.
  for (const name of M.ARTICULATIONS) assert.ok(SCRIPT_NAMES.includes(name), `${name} is one of LilyPond's`);
});

test("a sign the model has never heard of is said, not dropped: the net holds for what comes next", () => {
  // What the engraver reads and no model field holds: here, a staff's own setting written in the music.
  const read = { piece: [], staves: [{ kind: "Notes", signs: ["pitches 14/0", "a sign of next year", "script trill 0", "Bar |. false false false"] }] };
  const written = { piece: [], staves: [{ kind: "Notes", signs: ["pitches 14/0", "Bar |. false false false"] }] };
  const gone = M.signsLost(read, written);
  assert.deepEqual(gone.map((g) => g.sign), ["a sign of next year", "script trill 0"]);
  assert.deepEqual(M.namesOfLost(gone), ["a", "\\trill"]);
  // The same sign written another way is the same sign: a repeat's bar lines, the final bar line.
  assert.deepEqual(M.signsLost({ piece: [], staves: [{ signs: ["Bar .|: false false false", "pitches 1/0", "Bar || false false false"] }] }, { piece: [], staves: [{ signs: ["RepeatStart  false false false", "pitches 1/0", "Bar |. false false false"] }] }), []);
  // A staff that is gone is all its signs gone.
  assert.equal(M.signsLost({ piece: [], staves: [{ signs: ["pitches 1/0"] }, { signs: ["pitches 2/0"] }] }, { piece: [], staves: [{ signs: ["pitches 1/0"] }] }).length, 1);
  // A rewrite the engraver refuses is said too.
  assert.deepEqual(M.unkept({ staves: [] }, "{ c'4 }", () => { throw new Error("refused"); }), ["what the engraver does not read back from the score editor"]);
});

// ---- The engraver's own corpus -------------------------------------------------------------

/** The .ly files under `dir`, but the bombs (texts written to be refused). */
function lilyFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "bombs" ? [] : lilyFiles(path);
    return name.endsWith(".ly") ? [path] : [];
  });
}

// The engraver's tests' own texts (eui, crates/eui-score/tests: lilypond/ with the real files the site
// held, corpus/, written/), copied here as they were at eui 83348e1 — but the bombs, written to be refused.
// What the editor does not keep whole of them, and says — or leaves to the text.
const NOT_WHOLE = [
  // Each of these wants a thing the model has no place for yet — a feature of its own, not a sign:
  "lilypond/d07_repeats.ly", // left to the text: \repeat percent (bars that are copies of one, drawn as %)
  "lilypond/unfold.ly", // left to the text: \repeat percent
  "lilypond/d12_frets.ly", // left to the text: \new FretBoards, a line of guitar chord diagrams
  "written/pieces/chord-diagrams.ly", // left to the text: \new FretBoards
  "lilypond/d16_real_files.ly", // left to the text: several movements, one \score after another
  "lilypond/real/set-2-antiquities.ly", // left to the text: several movements
  "lilypond/real/telemann-prod.ly", // left to the text: an ossia in a context its \layout defines
  "lilypond/real/telemann.ly", // left to the text: the same
  "lilypond/real/blues-en-sib.ly", // left to the text: chord names in \language "english" (the model writes Dutch names)
  "lilypond/real/grand-cerf.ly", // said: the settings the engraver passes over (an \epsfile, fonts), and a file that never prints its music
];
const CORPUS = new URL("./fixtures/engraver-corpus", import.meta.url).pathname;

test("the engraver's corpus and the real files: nothing is lost in silence", () => {
  const files = lilyFiles(CORPUS);
  assert.ok(files.length >= 80, `${files.length} files`);
  const seen = { kept: 0, said: 0, text: 0, refused: 0 };
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    try {
      score_json(src);
    } catch {
      // A text the engraver refuses opens as text: there is nothing to lose.
      seen.refused++;
      continue;
    }
    const r = through(src);
    assert.notEqual(r.how, "LOST", `${file}: lost in silence\n${show(r).slice(0, 2000)}`);
    seen[r.how]++;
    const name = file.slice(CORPUS.length + 1);
    if (process.env.SAID) {
      // To write the list again: SAID=1 node --test tests/js/round_trip.test.mjs
      if (r.how !== "kept") console.log(`  "${name}", // ${r.how === "text" ? "left to the text: " : ""}${r.why.join(", ")}`);
      continue;
    }
    // What the editor wrote is the editor's: read again, nothing more is left out.
    if (r.out && r.score && r.how === "kept") assert.deepEqual(M.unkept(M.fromParsed(withSpans(r.out), r.out, { parse: withSpans }).score, r.out, reading), [], `${name}: the editor's own text`);
    if (r.how === "kept") assert.ok(!NOT_WHOLE.includes(name), `${name} comes back whole now: take it out of the list of what does not`);
    else assert.ok(NOT_WHOLE.includes(name), `${name} came back whole before; now ${r.how === "text" ? "it is left to the text" : "the page says it does not keep"}: ${r.why.join(", ")}\n${show(r).slice(0, 2000)}`);
  }
  console.log(`engraver corpus: ${files.length} files — ${seen.kept} kept whole, ${seen.said} with what is left out said, ${seen.text} left to the text, ${seen.refused} refused by the engraver`);
  if (!process.env.SAID) assert.equal(seen.kept, files.length - NOT_WHOLE.length);
});
