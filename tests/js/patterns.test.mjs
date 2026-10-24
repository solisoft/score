// The drum grid, the arpeggiator and the chord track
// (public/eui-score/patterns.js), on scores read by the real engraver and
// written back: what each writes is read again as it was meant.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as G from "../../public/eui-score/patterns.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
/** The score written out and read again, as a save and a reload do. */
const again = (score) => read(M.toLilyPond(score).source);
const body = (score) => M.toLilyPond(score).source.replace(/^[^]*?\\time [^\n]*\n\s*/, "").replace(/\s*\\bar[^]*$/, "");

/** Lane `s`'s notes in bar `b`: their LilyPond, rests as "r". */
function notes(score, s, b) {
  const staff = score.staves[s];
  const at = M.starts(staff);
  const [t0, t1] = [M.barStart(score, b), M.barStart(score, b + 1)];
  return staff.events.filter((_, i) => at[i] >= t0 && at[i] < t1).map((ev) => (ev.rest ? "r" : ev.pitches.map((p) => p.drum ?? M.spellPitch(p.d, p.alter)).join(" ")));
}

// ---- The drum grid --------------------------------------------------------------------

test("an empty drum bar is a grid of sixteen silent steps; a 6/8 bar has twelve", () => {
  const score = read(M.toLilyPond(M.fromTemplate("drums", { bars: 2 })).source);
  const grid = G.drumGrid(score, 0, 0);
  assert.equal(grid.steps, 16);
  assert.ok(G.GRID_DRUMS.every((name) => grid.rows[name].every((v) => v === 0)));
  assert.equal(grid.fits, true);
  const compound = read(M.toLilyPond(M.fromTemplate("drums", { bars: 1, time: [6, 8] })).source);
  assert.equal(G.drumGrid(compound, 0, 0).steps, 12);
  assert.equal(G.beatTicks(compound, 0), (3 * M.WHOLE) / 8, "6/8 beats in dotted quarters");
});

test("a rock beat checked on the grid is written as drum chords, accent and all, and read back the same", () => {
  const score = read(M.toLilyPond(M.fromTemplate("drums", { bars: 2 })).source);
  const grid = G.drumGrid(score, 0, 0);
  for (let k = 0; k < 16; k += 2) grid.rows.hh[k] = 1;
  for (const k of [0, 8, 10]) grid.rows.bd[k] = 1;
  for (const k of [4, 12]) grid.rows.sn[k] = 2;
  G.writeDrumGrid(score, 0, grid);
  const text = M.toLilyPond(score).source;
  assert.match(text, /\\drummode/);
  assert.match(text, /<bd hh>8 hh8 <sn hh>8-> hh8 <bd hh>8 <bd hh>8 <sn hh>8-> hh8 \| r1/);
  const back = G.drumGrid(again(score), 0, 0);
  assert.deepEqual(back.rows.hh, [1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 1, 0, 2, 0, 1, 0], "an accent is the whole stroke's");
  assert.deepEqual(back.rows.bd, [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(back.rows.sn, [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0]);
  assert.deepEqual(notes(again(score), 0, 1), ["r"], "the next bar is left alone");
});

test("a stroke rings to the next one or the end of its beat; silence between is rests", () => {
  const score = read(M.toLilyPond(M.fromTemplate("drums", { bars: 1 })).source);
  const grid = G.drumGrid(score, 0, 0);
  grid.rows.bd[0] = 1;
  grid.rows.cymc[6] = 1;
  G.writeDrumGrid(score, 0, grid);
  assert.equal(body(score), "bd4 r8 cymc8 r2");
});

test("drums the grid has no row for are kept; a stroke between the steps says it does not fit", () => {
  const score = read("\\new DrumStaff \\drummode { \\time 4/4 <bd cb>4 sn4 \\tuplet 3/2 { hh8 hh hh } sn4 }");
  const grid = G.drumGrid(score, 0, 0);
  assert.deepEqual(grid.others[0], ["cb"]);
  assert.equal(grid.fits, false);
  grid.rows.sn[4] = 0;
  G.writeDrumGrid(score, 0, grid);
  const back = notes(again(score), 0, 0);
  assert.equal(back[0], "bd cb", "the cowbell stays with the kick");
  assert.ok(!back.includes("sn") || back.indexOf("sn") > 1, "the snare taken away from step 5");
});

test("the grid is refused on a staff of notes", () => {
  const score = read("{ \\time 4/4 c'1 }");
  assert.throws(() => G.drumGrid(score, 0, 0), /drum staff/);
  assert.throws(() => G.writeDrumGrid(score, 0, { bar: 0, steps: 16, rows: {} }), /drum staff/);
});

test("a cell goes silent, struck, accented, silent", () => {
  assert.deepEqual([0, 1, 2].map(G.nextCell), [1, 2, 0]);
});

// ---- The arpeggiator ------------------------------------------------------------------

test("chords broken up and down in eighths, each over the time it held; the chord symbol kept", () => {
  const score = read("{ \\time 4/4 <c' e' g'>2^\"C\" <a c' e'>2 | <f a c'>1 }");
  const count = G.arpeggiate(score, 0, 0, 2, { pattern: "up-down", step: "8" });
  assert.equal(count, 3);
  const back = again(score);
  assert.deepEqual(notes(back, 0, 0), ["c'", "e'", "g'", "e'", "a", "c'", "e'", "c'"]);
  assert.deepEqual(notes(back, 0, 1), ["f", "a", "c'", "a", "f", "a", "c'", "a"]);
  assert.equal(back.staves[0].events[0].chord, "C");
});

test("down, and sixteenths over two octaves; a chord tied over the bar line is one", () => {
  const score = read("{ \\time 2/4 <c' e'>2 ~ | <c' e'>4 r4 }");
  G.arpeggiate(score, 0, 0, 2, { pattern: "down", step: "16", octaves: 2 });
  const back = again(score);
  assert.deepEqual(notes(back, 0, 0), ["e''", "c''", "e'", "c'", "e''", "c''", "e'", "c'"]);
  assert.deepEqual(notes(back, 0, 1), ["e''", "c''", "e'", "c'", "r"]);
});

test("triplet eighths come a quarter at a time, in tuplets", () => {
  const score = read("{ \\time 4/4 <c' e' g'>2 <a c' e'>2 }");
  G.arpeggiate(score, 0, 0, 1, { pattern: "up", step: "8t" });
  const text = M.toLilyPond(score).source;
  assert.match(text, /\\tuplet 3\/2 \{ c'8 e'8 g'8 \} \\tuplet 3\/2 \{ c'8 e'8 g'8 \} \\tuplet 3\/2 \{ a8 c'8 e'8 \}/);
  assert.equal(again(score).staves[0].events.filter((ev) => ev.tuplet).length, 12);
});

test("random never plays the same note twice running, and takes its notes from the chord", () => {
  const score = read("{ \\time 4/4 <c' e' g'>1 }");
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  G.arpeggiate(score, 0, 0, 0, { pattern: "random", step: "16", random });
  const played = notes(again(score), 0, 0);
  assert.equal(played.length, 16);
  assert.ok(played.every((p) => ["c'", "e'", "g'"].includes(p)));
  assert.ok(played.every((p, k) => k === 0 || p !== played[k - 1]));
});

test("the arpeggiator refuses rests, single notes over one octave, drums and unknown patterns", () => {
  const score = read("{ \\time 4/4 c'4 r4 d'2 }");
  assert.throws(() => G.arpeggiate(score, 0, 0, 2), /Select chords/);
  assert.equal(G.arpeggiate(score, 0, 0, 0, { octaves: 2, step: "8" }), 1, "a single note runs over its octaves");
  assert.deepEqual(notes(again(score), 0, 0).slice(0, 2), ["c'", "c''"]);
  assert.throws(() => G.arpeggiate(score, 0, 0, 0, { pattern: "sideways" }), /no arpeggio pattern/);
  assert.throws(() => G.arpeggiate(score, 0, 0, 0, { step: "4" }), /step/);
  const drums = read("\\new DrumStaff \\drummode { \\time 4/4 <bd sn>1 }");
  assert.throws(() => G.arpeggiate(drums, 0, 0, 0), /drum staff/);
});

test("the pool and the patterns", () => {
  const pool = G.arpeggioPool([{ d: 11, alter: 0 }, { d: 7, alter: 0 }, { d: 9, alter: 0 }, { d: 7, alter: 0 }], 2);
  assert.deepEqual(pool.map((p) => M.spellPitch(p.d, p.alter)), ["c'", "e'", "g'", "c''", "e''", "g''"], "sorted, doubled notes once");
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => M.spellPitch(G.arpeggioNote(pool, "up-down", k).d, 0)), ["c'", "e'", "g'", "c''", "e''", "g''", "e''", "c''", "g'", "e'", "c'"]);
  assert.equal(G.arpeggioNote([pool[0]], "up-down", 3), pool[0]);
  assert.equal(G.arpeggioNote([pool[0]], "random", 3), pool[0]);
  assert.equal(G.arpeggioPool([{ d: 35, alter: 0 }], 3).length, 1, "nothing past the top of the keyboard");
  assert.equal(G.arpeggioPool([{ d: 40, alter: 0 }], 1).length, 1, "a note already past it is left as it is");
});

// ---- The chord track ------------------------------------------------------------------

test("chord symbols read as their notes: triads, sevenths, sixths, ninths, sus, slash", () => {
  const names = (text) => {
    const v = G.chordVoicing(text);
    return [M.pitchName(v.bass.d, v.bass.alter), ...v.pitches.map((p) => M.pitchName(p.d, p.alter))].join(" ");
  };
  assert.equal(names("C"), "C3 C4 E4 G4");
  assert.equal(names("Am7"), "A3 A4 C5 E5 G5");
  assert.equal(names("Cmaj7"), "C3 C4 E4 G4 B4");
  assert.equal(names("G7"), "G3 G4 B4 D5 F5");
  assert.equal(names("Bdim"), "B3 B4 D5 F5");
  assert.equal(names("Cdim7"), "C3 C4 E♭4 G♭4 B𝄫4");
  assert.equal(names("Cø7"), "C3 C4 E♭4 G♭4 B♭4");
  assert.equal(names("Cm7b5"), "C3 C4 E♭4 G♭4 B♭4");
  assert.equal(names("Caug"), "C3 C4 E4 G♯4");
  assert.equal(names("Csus4"), "C3 C4 F4 G4");
  assert.equal(names("Csus2"), "C3 C4 D4 G4");
  assert.equal(names("C6"), "C3 C4 E4 G4 A4");
  assert.equal(names("C6/9"), "C3 C4 E4 G4 A4 D5");
  assert.equal(names("C/E"), "E3 C4 E4 G4");
  assert.equal(names("F#m"), "F♯3 F♯4 A4 C♯5");
  assert.equal(names("Bb7"), "B♭3 B♭4 D5 F5 A♭5");
  assert.equal(names("Cm(maj7)"), "C3 C4 E♭4 G4 B4");
  assert.equal(names("C7b9"), "C3 C4 E4 G4 B♭4 D♭5");
  assert.equal(names("C(add9)"), "C3 C4 E4 G4 D5");
  assert.equal(G.chordTones("Do"), null, "a word is not a chord");
  assert.equal(G.chordVoicing("Bad"), null);
});

const SONG = `<< \\new Staff { \\time 4/4 c''1^"C" | a'2^"Am" f'2^"F" | g'1^"G7" | c''1 }
\\new Staff { \\clef bass c1 | c1 | c1 | c1 } >>`;

test("block chords on the bass staff, each struck again each bar, the last one held on", () => {
  const score = read(SONG);
  assert.deepEqual(G.chordSymbols(score).map((c) => c.text), ["C", "Am", "F", "G7"]);
  assert.equal(G.chordTrack(score, 1, { style: "block" }), 4);
  const back = again(score);
  assert.deepEqual(notes(back, 1, 0), ["c, c e g"]);
  assert.deepEqual(notes(back, 1, 1), ["a, a c' e'", "f, f a c'"]);
  assert.deepEqual(notes(back, 1, 3), ["g, g b d' f'"], "G7 struck again in the last bar");
  assert.deepEqual(notes(back, 0, 0), ["c''"], "the melody is left alone");
});

test("arpeggiated, and bass then the chord, in the bars selected only", () => {
  const score = read(SONG);
  G.chordTrack(score, 1, { style: "arpeggio", a: 1, b: 1 });
  let back = again(score);
  assert.deepEqual(notes(back, 1, 0), ["c"], "bar 1 is outside");
  assert.deepEqual(notes(back, 1, 1), ["a,", "a", "c'", "e'", "f,", "f", "a", "c'"]);
  assert.deepEqual(notes(back, 1, 2), ["c"]);
  G.chordTrack(score, 1, { style: "bass-chord", a: 2, b: 3 });
  back = again(score);
  assert.deepEqual(notes(back, 1, 2), ["g,", "g b d' f'", "g b d' f'", "g b d' f'"]);
  assert.deepEqual(notes(back, 1, 3), ["g,", "g b d' f'", "g b d' f'", "g b d' f'"], "the chord set before the bars sounds in them");
});

test("on a treble staff the chords sit around middle C; a chord symbol on that staff stays", () => {
  const score = read(`{ \\time 4/4 c'1^"C" | d'1^"Dm" }`);
  G.chordTrack(score, 0, { style: "bass-chord" });
  const back = again(score);
  assert.deepEqual(notes(back, 0, 0), ["c", "c' e' g'", "c' e' g'", "c' e' g'"]);
  assert.equal(back.staves[0].events[0].chord, "C");
  const second = back.staves[0].events[M.eventAt(back.staves[0], M.barStart(back, 1))];
  assert.equal(second.chord, "Dm");
});

test("the chord track refuses a score without chord symbols, a drum staff and an unknown style", () => {
  assert.throws(() => G.chordTrack(read("{ \\time 4/4 c'1 }"), 0), /No chord symbols/);
  const band = read(`<< \\new Staff { \\time 4/4 c'1^"C" } \\new DrumStaff \\drummode { bd1 } >>`);
  assert.throws(() => G.chordTrack(band, 1), /drum staff/);
  assert.throws(() => G.chordTrack(band, 0, { style: "polka" }), /no accompaniment/);
  assert.throws(() => G.chordTrack(band, 5), /no such staff/);
});
