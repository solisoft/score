// \afterGrace in MusicXML (#392): written as <grace/> notes after their
// note, each with the part of it they take (steal-time-previous), and read
// back so — and, from MuseScore's or Finale's files, grace notes that end a
// measure, or come before a rest, read as the note's \afterGrace.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const PROBE = "{ \\afterGrace c''1 { d''16 } }";
/** The engraver hands \afterGrace's notes over to the editor (eui #389 on). */
let HANDS_OVER = false;
try {
  HANDS_OVER = JSON.parse(score_json(PROBE)).staves[0].events.some((ev) => "after_graces" in ev);
} catch {}
const skip = !HANDS_OVER && "this engraver does not hand \\afterGrace's notes over";

/** The editor's score for a LilyPond text. */
function scoreOf(source) {
  const read = M.fromParsed(JSON.parse(score_json(source)), source);
  assert.ok(read.score, `the editor reads it (${(read.unsupported ?? []).join(", ")})\n${source}`);
  return read.score;
}

/** Each note's pitches and value, and its after-grace notes with where they start. */
const shape = (score) =>
  score.staves[0].events.map((ev) => ({
    note: ev.rest ? "r" : ev.pitches.map((p) => M.spellPitch(p.d, p.alter)).join(" "),
    value: `${ev.base}${".".repeat(ev.dots)}`,
    graces: ev.graces.length ? ev.graces.map((g) => g.pitches.map((p) => M.spellPitch(p.d, p.alter)).join(" ") + g.base) : undefined,
    after: ev.afterGraces?.length ? ev.afterGraces.map((g) => g.pitches.map((p) => M.spellPitch(p.d, p.alter)).join(" ") + g.base + ".".repeat(g.dots)) : undefined,
    at: ev.afterGraces?.length ? ev.afterAt : undefined,
  }));

const partwise = (measures) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
<part id="P1">${measures}</part></score-partwise>`;
const ATTRS = "<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>";
const note = (step, octave, duration, type, extra = "") => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
const grace = (step, octave, type = "16th", attrs = "") => `<note><grace${attrs}/><pitch><step>${step}</step><octave>${octave}</octave></pitch><voice>1</voice><type>${type}</type></note>`;

test("written after their note as <grace/> notes taking part of it, the measure's time the note's alone", { skip }, () => {
  const score = scoreOf("{ \\time 4/4 c''4 \\afterGrace d''2 { e''16 f''16 } c''4 | \\afterGrace 7/8 <g' b'>1 { <a' c''>16 } }");
  const xml = X.toMusicXML(score);
  const first = xml.slice(xml.indexOf('<measure number="1"'), xml.indexOf('<measure number="2"'));
  // In order: c, d, then d's grace notes, then c.
  const order = [...first.matchAll(/<note>(<grace[^>]*>)?(?:<chord\/>)?<pitch><step>([A-G])/g)].map((m) => (m[1] ? `(${m[2]})` : m[2]));
  assert.deepEqual(order, ["C", "D", "(E)", "(F)", "C"]);
  assert.equal([...first.matchAll(/steal-time-previous="25"/g)].length, 2, "3/4 of the note: a quarter of it taken");
  // Grace notes have no duration: the measure is 4 beats, as without them.
  const durations = [...first.matchAll(/<duration>(\d+)<\/duration>/g)].map((m) => Number(m[1]));
  const divisions = Number(/<divisions>(\d+)<\/divisions>/.exec(xml)[1]);
  assert.equal(durations.reduce((a, b) => a + b, 0), 4 * divisions);
  const second = xml.slice(xml.indexOf('<measure number="2"'));
  assert.match(second, /<grace steal-time-previous="13"\/><pitch><step>A<\/step>/, "7/8: an eighth taken, rounded");
  assert.match(second, /<grace steal-time-previous="13"\/><chord\/><pitch><step>C<\/step>/, "a chord of grace notes: its second note a <chord/>");
});

test("round trip: the after-grace notes, their values, their chord and their fraction come back", { skip }, () => {
  const source = "{ \\time 4/4 c''4 \\afterGrace d''2 { e''16 f''16 } c''4 | \\afterGrace 7/8 <g' b'>1 { <a' c''>16 } | \\afterGrace g'1 { a'8. } }";
  const before = scoreOf(source);
  const { source: back, warnings } = X.fromMusicXML(X.toMusicXML(before));
  assert.deepEqual(warnings, []);
  assert.match(back, /\\afterGrace d''2 \{ e''16 f''16 \}/);
  assert.match(back, /\\afterGrace 7\/8 <g' b'>1 \{ <a' c''>16 \}/);
  assert.deepEqual(shape(scoreOf(back)), shape(before));
  const ends = shape(scoreOf(back)).at(-1);
  assert.deepEqual([ends.after, ends.at], [["a'8."], M.AFTER_GRACE_AT], "at the end of the score too");
});

test("a grace note before its note stays before it, and takes nothing after the note before", { skip }, () => {
  const before = scoreOf("{ \\time 2/4 c''4 \\acciaccatura d''8 e''4 | \\grace { f''16 g''16 } a''2 }");
  const xml = X.toMusicXML(before);
  assert.doesNotMatch(xml, /steal-time-previous/);
  const after = scoreOf(X.fromMusicXML(xml).source);
  assert.deepEqual(shape(after), shape(before));
  assert.equal(after.staves[0].events[1].grace, "acciaccatura");
  assert.ok(after.staves[0].events.every((ev) => !ev.afterGraces?.length));
});

test("a file in MuseScore's shape: grace notes ending a measure are its last note's \\afterGrace", { skip }, () => {
  const xml = partwise(`
    <measure number="1">${ATTRS}${note("C", 5, 8, "half")}${note("D", 5, 8, "half")}${grace("E", 5)}${grace("F", 5)}</measure>
    <measure number="2">${note("G", 5, 16, "whole")}</measure>`);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.match(source, /\\afterGrace d''2 \{ e''16 f''16 \} \|/);
  const events = shape(scoreOf(source));
  assert.deepEqual(events[1], { note: "d''", value: "2", graces: undefined, after: ["e''16", "f''16"], at: M.AFTER_GRACE_AT });
  assert.equal(events[2].graces, undefined, "not the next bar's first note's");
});

test("grace notes in the middle of a measure, not marked, stay the next note's; before a rest, the note before's", { skip }, () => {
  const xml = partwise(`
    <measure number="1">${ATTRS}${note("C", 5, 4, "quarter")}${grace("D", 5, "eighth", ' slash="yes"')}${note("E", 5, 4, "quarter")}${grace("F", 5)}<note><rest/><duration>8</duration><voice>1</voice><type>half</type></note></measure>`);
  const events = shape(scoreOf(X.fromMusicXML(xml).source));
  assert.deepEqual(events[1].graces, ["d''8"], "the slashed grace before E is E's");
  assert.equal(events[0].after, undefined);
  assert.deepEqual(events[1].after, ["f''16"], "a rest takes no grace notes: they are E's");
});

test("steal-time-previous in the middle of a measure: the note before's, at the part it says", { skip }, () => {
  const xml = partwise(`
    <measure number="1">${ATTRS}${note("C", 5, 8, "half")}${grace("D", 5, "16th", ' steal-time-previous="50"')}${note("E", 5, 8, "half")}</measure>`);
  const { source } = X.fromMusicXML(xml);
  assert.match(source, /\\afterGrace 1\/2 c''2 \{ d''16 \} e''2/);
  const events = shape(scoreOf(source));
  assert.deepEqual([events[0].after, events[0].at, events[1].graces], [["d''16"], 1 / 2, undefined]);
});

test("a tied note, a slurred and beamed one: their after-grace notes come between the note and its marks", { skip }, () => {
  const xml = partwise(`
    <measure number="1">${ATTRS}${note("C", 5, 8, "half", '<notations><tied type="start"/></notations>')}${grace("B", 4, "16th", ' steal-time-previous="25"')}${note("C", 5, 8, "half", '<notations><tied type="stop"/></notations>')}</measure>
    <measure number="2">${note("D", 5, 2, "eighth", '<beam number="1">begin</beam><notations><slur type="start"/></notations>')}${note("E", 5, 2, "eighth", '<beam number="1">end</beam><notations><slur type="stop"/></notations>')}${grace("F", 5, "16th", ' steal-time-previous="25"')}${grace("A", 5, "eighth", ' slash="yes"')}${note("G", 5, 12, "half", "<dot/>")}</measure>`);
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.match(source, /\\afterGrace c''2 \{ b'16 \}~/);
  assert.match(source, /\\afterGrace e''8 \{ f''16 a''8 \}\)\]/);
  const score = scoreOf(source);
  const events = score.staves[0].events;
  assert.ok(events[0].tie, "the tie is still the note's");
  assert.deepEqual(shape(score)[0].after, ["b'16"]);
  assert.ok(events[3].slurEnd, "the slur still ends on E");
  assert.deepEqual(shape(score)[3].after, ["f''16", "a''8"], "marked, the whole run of grace notes is E's");
  assert.equal(shape(score)[4].graces, undefined);
});

test("a tied note's after-grace notes are written between it and the note it is tied to", () => {
  // Built in the model: tied, with after-grace notes, whatever the engraver reads.
  const score = M.newScore();
  score.staves[0].events = [
    M.makeEvent({ rest: false, pitches: [{ d: 14, alter: 0 }], base: 1, tie: true, afterGraces: [{ pitches: [{ d: 15, alter: 0 }], base: 16, dots: 0 }], afterAt: 3 / 4 }),
    M.makeEvent({ rest: false, pitches: [{ d: 14, alter: 0 }], base: 1 }),
  ];
  const xml = X.toMusicXML(score);
  const notes = [...xml.matchAll(/<note>.*?<\/note>/g)].map((m) => m[0]);
  assert.equal(notes.length, 3);
  assert.match(notes[0], /<tie type="start"\/>/);
  assert.match(notes[1], /^<note><grace steal-time-previous="25"\/><pitch><step>D<\/step><octave>5<\/octave>/);
  assert.doesNotMatch(notes[1], /<duration>/);
  assert.match(notes[2], /<tie type="stop"\/>/);
  // And read back with its tie after the grace notes.
  assert.match(X.fromMusicXML(xml).source, /\\afterGrace c''1 \{ d''16 \}~ \| c''1/);
});
