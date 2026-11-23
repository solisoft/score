// An instrument changed in the middle of a staff (#1023): from a note on,
// the staff is named for the new instrument, plays its sound and — for a
// transposing one — is written as its player reads it (\transposition);
// "To Picc." goes in the rests before, the instrument's name over its first
// note. The commands are kept on their note, read back as written, and go
// into the part.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as R from "../../public/eui-score/review.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });
const parse = (src) => ({ ...JSON.parse(score_json(src)), spans: JSON.parse(source_spans(src)) });
function read(src) {
  const result = M.fromParsed(parse(src), src, { parse });
  assert.ok(result.score, `reads: ${result.unsupported}`);
  assert.equal(result.lost, undefined, "nothing lost");
  return result.score;
}
const names = (score, lane = 0) => score.staves[lane].events.filter((ev) => !ev.rest).map((ev) => ev.pitches.map((p) => M.pitchName(p.d, p.alter)).join("+"));
/** The MIDI a text plays: each note-on's key, and each program change, in order. */
function heard(src) {
  const smf = F.readSmf(midi(src, 100, 4, 0));
  const events = smf.tracks.flat().filter((ev) => ((ev.data[0] & 0xf0) === 0x90 && ev.data[2] > 0) || (ev.data[0] & 0xf0) === 0xc0);
  return events.sort((a, b) => a.tick - b.tick).map((ev) => ((ev.data[0] & 0xf0) === 0xc0 ? `program ${ev.data[1]}` : ev.data[1]));
}
const at = (name) => M.INSTRUMENTS.findIndex((it) => it.name === name);
const words = (name, short) => ({ name, to: `To ${short}`, known: M.INSTRUMENTS.flatMap((it) => [it.name, `To ${it.short}`]) });

const FLUTE = `\\new Staff \\with { instrumentName = "Flute" shortInstrumentName = "Fl." midiInstrument = "flute" } { c''4 d'' e'' f'' | R1 | R1 | c''4 d'' e'' f'' }`;

test("the flute to the piccolo: its names and sound from bar 4, To Picc. in the rests, Piccolo over its note", () => {
  const score = read(FLUTE);
  const done = M.changeInstrument(score, 0, M.barStart(score, 3), at("Piccolo"), words("Piccolo", "Picc."));
  assert.equal(done.was, "Flute");
  const text = M.toLilyPond(score).source;
  assert.match(text, /f''4 \| r1\^"To Picc\." \| r1 \| \\set Staff\.instrumentName = "Piccolo" \\set Staff\.shortInstrumentName = "Picc\." \\set Staff\.midiInstrument = "piccolo" c''4\^"Piccolo" d''4/);
  // A piccolo is written as this editor writes it, as it sounds: no \transposition.
  assert.doesNotMatch(text, /\\transposition/);
  // Read back: the same text, nothing kept apart.
  assert.equal(M.toLilyPond(read(text)).source, text);
  assert.equal(M.instrumentAt(score, 0, 0), at("Flute"));
  assert.equal(M.instrumentAt(score, 0, M.barStart(score, 3)), at("Piccolo"));
  // Played: the piccolo's program from there (General MIDI 73 flute, 72 piccolo).
  const played = heard(text);
  assert.deepEqual(played.filter((x) => typeof x === "string"), ["program 73", "program 72"]);
});

test("the flute to a B♭ clarinet: \\transposition bes, the notes after it written a tone up and played as they sound", () => {
  const score = read(FLUTE);
  M.changeInstrument(score, 0, M.barStart(score, 3), at("Clarinet in B♭"), words("Clarinet in B♭", "Cl."));
  const text = M.toLilyPond(score).source;
  assert.match(text, /\| r1 \| \\key d \\major \\set Staff\.instrumentName = "Clarinet in B♭" \\set Staff\.shortInstrumentName = "Cl\." \\set Staff\.midiInstrument = "clarinet" \\transposition bes d''4\^"Clarinet in B♭" e''4 fis''4 g''4/);
  // The notes are those it had: as they sound.
  assert.deepEqual(names(score).slice(4), ["C5", "D5", "E5", "F5"]);
  assert.deepEqual(heard(text).filter((x) => typeof x === "number").slice(4), [72, 74, 76, 77]);
  assert.deepEqual(names(read(text)), names(score));
  assert.deepEqual(M.writtenShiftAt(score, 0, M.barStart(score, 3)), { steps: 1, semitones: 2 });
  // Drawn at concert pitch: as they sound, the key the score's.
  assert.match(M.toLilyPond(score, { written: false }).source, /\\transposition bes c''4\^"Clarinet in B♭" d''4 e''4 f''4/);
});

test("back to the flute after the clarinet: \\transposition c' says the notes sound as written again", () => {
  const score = read(`${FLUTE.slice(0, -2)} | R1 | c''1 }`);
  M.changeInstrument(score, 0, M.barStart(score, 3), at("Clarinet in B♭"), words("Clarinet in B♭", "Cl."));
  M.changeInstrument(score, 0, M.barStart(score, 5), at("Flute"), words("Flute", "Fl."));
  const text = M.toLilyPond(score).source;
  assert.match(text, /\|\s+r1\^"To Fl\." \| \\key c \\major \\set Staff\.instrumentName = "Flute" [^|]*\\transposition c' c''1\^"Flute"/);
  assert.equal(M.writtenShiftAt(score, 0, M.barStart(score, 5)), null);
  assert.deepEqual(names(read(text)), names(score));
});

test("chosen again at the same place, the change before is replaced, words and all", () => {
  const score = read(FLUTE);
  const t = M.barStart(score, 3);
  M.changeInstrument(score, 0, t, at("Clarinet in B♭"), words("Clarinet in B♭", "Cl."));
  M.changeInstrument(score, 0, t, at("Oboe"), words("Oboe", "Ob."));
  const text = M.toLilyPond(score).source;
  assert.doesNotMatch(text, /Clarinet|Cl\.|\\transposition/);
  assert.equal((text.match(/\\set Staff\.instrumentName/g) ?? []).length, 1);
  assert.match(text, /r1\^"To Ob\." \| r1 \| \\set Staff\.instrumentName = "Oboe" [^|]*c''4\^"Oboe"/);
  // Words written by hand there stay.
  const own = read(FLUTE.replace("| R1 | R1 |", "| r1^\"tacet\" | R1 |"));
  M.changeInstrument(own, 0, t, at("Oboe"), words("Oboe", "Ob."));
  M.changeInstrument(own, 0, t, at("Oboe"), words("Oboe", "Ob."));
  assert.match(M.toLilyPond(own).source, /r1\^"tacet"\^"To Ob\."/);
});

test("refused: at the very start, on a drum kit, where nothing starts, on a drum staff", () => {
  const score = read(FLUTE);
  const before = M.toLilyPond(score).source;
  assert.throws(() => M.changeInstrument(score, 0, 0, at("Oboe")), /first instrument is its own/);
  assert.throws(() => M.changeInstrument(score, 0, M.barStart(score, 3), M.INSTRUMENTS.findIndex((it) => it.drums)), /drum kit/);
  assert.throws(() => M.changeInstrument(score, 0, M.barStart(score, 3) + 1, at("Oboe")), /where a note or a rest/);
  assert.throws(() => M.changeInstrument(score, 0, M.barStart(score, 3), 999), /no such instrument/);
  assert.equal(M.toLilyPond(score).source, before, "nothing written");
  const drums = read("\\new DrumStaff \\drummode { sn4 sn sn sn | sn1 }");
  assert.throws(() => M.changeInstrument(drums, 0, M.barStart(drums, 1), at("Oboe")), /drum/);
});

test("the part carries the change: played and written so, the words over its notes, no staff name", () => {
  const score = read(`<< ${FLUTE} \\new Staff \\with { instrumentName = "Cello" midiInstrument = "cello" } { \\clef bass c1 | c1 | c1 | c1 } >>`);
  M.changeInstrument(score, 0, M.barStart(score, 3), at("Clarinet in B♭"), words("Clarinet in B♭", "Cl."));
  const part = M.toLilyPond(M.partOf(score, 0), { written: true }).source;
  assert.match(part, /\\set Staff\.midiInstrument = "clarinet" \\transposition bes d''4\^"Clarinet in B♭"/);
  assert.match(part, /\^"To Cl\."/);
  assert.doesNotMatch(part, /\\set Staff\.(short)?[iI]nstrumentName/);
  assert.doesNotMatch(part, /Cello/);
});

test("the review reads the instrument played at each note: the clarinet's range after the change", () => {
  // Concert C3 on the clarinet (written D3) is below its lowest; on the flute before, a flute's low note out too.
  const score = read(`\\new Staff \\with { instrumentName = "Flute" midiInstrument = "flute" } { c''1\\p | R1 | R1 | R1 | R1 | c1\\p }`);
  M.changeInstrument(score, 0, M.barStart(score, 5), at("Clarinet in B♭"), words("Clarinet in B♭", "Cl."));
  const [range] = R.review(score).filter((r) => r.rule === "range");
  assert.equal(range.text, "Clarinet in B♭: written D3 is out of its range (the lowest written note is E3)");
  assert.equal(range.bar, 5);
});
