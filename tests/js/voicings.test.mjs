// Chords as players hold them (public/eui-score/voicings.js): a symbol
// read into its notes, a guitar shape that sounds them, the piano's hands
// led from one chord to the next, the bass in its range.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as V from "../../public/eui-score/voicings.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
const mod12 = (n) => ((n % 12) + 12) % 12;
const key = (p) => M.midiKey(p.d, p.alter);
const name = (p) => M.pitchName(p.d, p.alter);
/** A chord's pitch classes, its bass's with them. */
function classes(text) {
  const v = V.chordVoicing(text);
  return new Set([v.bass, ...v.pitches].map((p) => mod12(key(p))));
}

// ---- Reading -----------------------------------------------------------------------

test("elevenths, thirteenths, alt and omit are read; a ninth comes under an eleventh or a thirteenth", () => {
  const names = (text) => V.chordVoicing(text).pitches.map(name).join(" ");
  assert.equal(names("C11"), "C4 E4 G4 B♭4 D5 F5");
  assert.equal(names("C13"), "C4 E4 G4 B♭4 D5 A5");
  assert.equal(names("C7#11"), "C4 E4 G4 B♭4 D5 F♯5", "the ninth under the eleventh");
  assert.equal(names("C7b13"), "C4 E4 G4 B♭4 D5 A♭5");
  assert.equal(names("C7alt"), "C4 E4 G♯4 B♭4 D♭5 D♯5");
  assert.equal(names("C(add11)"), "C4 E4 G4 F5", "an addition brings no seventh and no ninth");
  assert.equal(names("C7(omit3)"), "C4 G4 B♭4");
  assert.equal(names("Cm11"), "C4 E♭4 G4 B♭4 D5 F5");
  assert.equal(V.chordTones("N.C."), null, "no chord");
});

// ---- The guitar --------------------------------------------------------------------

const QUALITIES = ["", "m", "7", "m7", "maj7", "sus2", "sus4", "7sus4", "6", "m6", "9", "m9", "dim", "dim7", "m7b5", "aug", "13", "7b9", "7#9", "add9", "mmaj7"];
const ROOTS = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"];
const symbolOf = (root, q) => (q === "mmaj7" ? `${root}m(maj7)` : q === "add9" ? `${root}(add9)` : `${root}${q}`);

test("every root and quality has a shape that sounds its chord: the root under it, its third, nothing else", () => {
  for (const root of ROOTS) {
    for (const q of QUALITIES) {
      const text = symbolOf(root, q);
      const shape = V.guitarShape(text);
      assert.ok(shape, `${text}: a shape`);
      assert.equal(shape.frets.length, 6, text);
      const played = shape.frets.filter((f) => f != null);
      assert.ok(played.length >= 3, `${text}: three strings at least`);
      assert.ok(played.every((f) => f >= 0 && f <= 15), `${text}: on the neck, ${shape.frets}`);
      const fingered = played.filter((f) => f > 0);
      assert.ok(!fingered.length || Math.max(...fingered) - Math.min(...fingered) <= 4, `${text}: within a hand's reach, ${shape.frets}`);
      const pitches = V.guitarPitches(text, shape);
      const chord = classes(text);
      const sounded = pitches.map((p) => mod12(key(p)));
      assert.ok(sounded.every((pc) => chord.has(pc)), `${text}: ${pitches.map(name)} are its notes`);
      const tones = V.chordTones(text);
      const rootPc = mod12(M.midiKey(tones.root.step, tones.root.alter));
      assert.equal(sounded[0], rootPc, `${text}: its root at the bottom, ${pitches.map(name)}`);
      const third = tones.tones.find(([steps]) => steps === 2 || steps === 1 || steps === 3);
      if (third) assert.ok(sounded.includes(mod12(rootPc + third[1])), `${text}: its third (or sus), ${pitches.map(name)}`);
      // The spec reads back as itself, barre and all.
      const spec = V.fretSpecOf(shape);
      assert.equal(M.fretSpec(spec), spec, `${text}: ${spec}`);
      assert.equal(M.fretSpec(M.fretText(spec)), spec, `${text}: typed as shown`);
    }
  }
});

test("open chords where guitarists play them, barres up the neck, the bass of a slash chord under it", () => {
  const typed = (text) => {
    const s = V.guitarShape(text);
    return s.frets.map((f) => (f == null ? "x" : f > 9 ? `(${f})` : String(f))).join("") + (s.barre ? ` barre ${s.barre.join("-")}` : "");
  };
  assert.equal(typed("C"), "x32010");
  assert.equal(typed("G"), "320003");
  assert.equal(typed("Am7"), "x02010");
  assert.equal(typed("D7"), "xx0212");
  assert.equal(typed("F"), "133211 barre 1-6-1", "F: the E shape at the first fret");
  assert.equal(typed("Bm"), "x24432 barre 2-5-1", "Bm: the A shape at the second");
  assert.equal(typed("Bb7"), "x13131 barre 1-5-1");
  assert.equal(typed("C#m7"), "x46454 barre 4-5-1");
  assert.equal(typed("C/E"), "032010", "the E under the C shape");
  assert.equal(typed("C/G"), "332010");
  assert.equal(typed("D/F#"), "2x0232");
  assert.equal(V.guitarShape("Cadd9").name, "Cadd9");
  assert.equal(V.guitarShape("C13").name, "C13");
  assert.equal(V.guitarShape("Bad"), null);
  assert.equal(V.fretSpecOf(V.guitarShape("F")), "1;3;3;2;1;1;|6-1-1");
});

test("a shape's diagram engraves, and reads back as itself", () => {
  const score = read(`{ c'1^"C" | f'1^"F" | b1^"Bm" | e'1^"C/E" }`);
  assert.equal(V.diagramsFromSymbols(score, 0), 4);
  const { source } = M.toLilyPond(score);
  assert.match(source, /\\fret-diagram "c:6-1-1;6-1;5-3;4-3;3-2;2-1;1-1;"/);
  JSON.parse(editor_view(source, 900, 7, -1, -1));
  const back = read(source);
  assert.deepEqual(back.staves[0].events.map((ev) => ev.fret), ["x;3;2;o;1;o;", "1;3;3;2;1;1;|6-1-1", "x;2;4;4;3;2;|5-1-2", "o;3;2;o;1;o;"]);
  // A diagram already there is kept; a second run finds nothing more to put.
  assert.throws(() => V.diagramsFromSymbols(back, 0), /No chord symbol there/);
  assert.throws(() => V.diagramsFromSymbols(read(`\\new DrumStaff \\drummode { bd4 sn bd sn }`), 0), /drum staff/);
});

// ---- The piano and the bass ---------------------------------------------------------

test("the piano's right hand moves to the nearest inversion; the left holds the bass and its fifth", () => {
  let previous = null;
  const moves = [];
  for (const text of ["C", "Am", "F", "G7", "C", "Dm7", "G7", "Cmaj7"]) {
    const v = V.pianoVoicing(text, previous);
    const keys = v.rh.map(key);
    assert.ok(keys.every((k) => k >= 55 && k <= 81), `${text}: the right hand in its range, ${v.rh.map(name)}`);
    assert.ok(v.rh.length <= 4);
    assert.ok(new Set(keys).size === keys.length, "no note twice");
    const chord = classes(text);
    assert.ok([...v.lh, ...v.rh].every((p) => chord.has(mod12(key(p)))), `${text}: its notes only`);
    if (previous) moves.push(Math.max(...keys.map((k) => Math.min(...previous.rh.map(key).map((p) => Math.abs(p - k))))));
    previous = v;
  }
  assert.ok(Math.max(...moves) <= 3, `each voice moves a third at most, ${moves}`);
  const c = V.pianoVoicing("C/E");
  assert.equal(name(c.lh[0]), "E2", "a slash chord's bass in the left hand");
  const shell = V.pianoVoicing("Dm7", null, { style: "shell" });
  assert.deepEqual(shell.lh.map(name), ["D3", "C4"], "a shell: the root and the seventh");
  assert.ok(!shell.rh.some((p) => mod12(key(p)) === 0), "the seventh not again in the right hand");
  assert.equal(V.pianoVoicing("C13").rh.length, 4, "a thirteenth chord thinned to four notes");
});

test("the bass stays in its range, near the note before; an approach leads a semitone into the next root", () => {
  let prev = null;
  for (const text of ["E", "A", "B7", "E", "G", "C", "D", "G"]) {
    const n = V.bassNote(text, "root", prev);
    const k = key(n);
    assert.ok(k >= V.BASS_LOW && k <= V.BASS_HIGH, `${text}: ${name(n)}`);
    if (prev) assert.ok(Math.abs(k - key(prev)) <= 7, `${text}: near ${name(prev)}, ${name(n)}`);
    prev = n;
  }
  assert.equal(name(V.bassNote("C/G", "root")), "G2", "a slash chord's bass");
  assert.equal(name(V.bassNote("Am", "fifth")), "E2");
  assert.equal(name(V.bassNote("Am", "third")), "C2");
  assert.equal(name(V.approachNote("F", { d: -5, alter: 0 })), "E2", "from E2, up into F2: a semitone under it");
  assert.equal(name(V.approachNote("C", { d: 2, alter: 0 })), "D♭3", "from E3, down into C3: a semitone over it, spelled falling");
  assert.equal(V.bassNote("Bad"), null);
});

test("the chord sounding at a time: the last symbol at or before it", () => {
  const score = read(`{ c'2^"C" e'2 | f'2^"F" g'2^"G7" }`);
  assert.equal(V.chordAt(score, 0), "C");
  assert.equal(V.chordAt(score, M.WHOLE / 2), "C");
  assert.equal(V.chordAt(score, M.WHOLE + M.WHOLE / 2), "G7");
  assert.equal(V.chordAt(read(`{ c'1 }`), 0), null);
});
