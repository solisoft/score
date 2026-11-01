// Chords as players hold them: a chord symbol read into its notes, a
// guitar's shape for it (open, or a barre up the neck), the piano's two
// hands, and the bass's note — each led from the chord before, so that the
// voices move as little as they can. The accompaniments (patterns.js) are
// written with these, and a chord diagram is found here for a symbol.
//
// No DOM here: tests/js/voicings.test.mjs calls these directly.

// The model at the same version as the page's.
const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);
const { tr } = await import(`./words.js${V}`);

const LETTERS = "CDEFGAB";
const SIGNS = { "#": 1, "♯": 1, b: -1, "♭": -1 };
const mod12 = (n) => ((n % 12) + 12) % 12;

// ---- Reading a chord symbol --------------------------------------------------------

/**
 * A chord symbol's notes: { root, bass, tones }, `root` the root's step (0 = C)
 * and alteration, `tones` its intervals above the root as [steps, semitones]
 * — the third (or sus), the fifth, a sixth, the seventh, a ninth, an
 * eleventh, a thirteenth, in that order — and `bass` the step and
 * alteration after a slash, or null. A ninth comes with an eleventh or a
 * thirteenth, as a jazz player reads them; `alt` is a seventh with a flat
 * and a sharp ninth and a sharp fifth; `omit3`, `omit5` leave them out.
 * Null for what is not a chord symbol (M.isChordSymbol), N.C. included.
 */
export function chordTones(text) {
  const symbol = String(text ?? "").trim();
  if (!M.isChordSymbol(symbol)) return null;
  const match = /^([A-G])([#♯b♭]?)(.*?)(?:\/([A-G])([#♯b♭]?))?$/.exec(symbol);
  const [, letter, sign, q, bassLetter, bassSign] = match;
  let third = [2, 4];
  let fifth = [4, 7];
  let seventh = null;
  const extra = [];
  const major7 = /^(maj|M(?!in)|Δ)|\(maj7\)|maj7/.test(q);
  const minor = /^(m(?!aj)|min|-)/.test(q);
  const alt = /alt/.test(q);
  // A 7, 9, 11 or 13 that is not an addition: the chord has its seventh.
  const bare = q.replace(/add\d+/g, "").replace(/6\/9/, "").replace(/omit\d/g, "");
  const extended = /(^|[^#♯b♭\d])(7|9|11|13)/.test(bare) || /^(maj|M|Δ)\d/.test(q) || alt;
  if (minor) third = [2, 3];
  if (/^(dim|°)/.test(q)) {
    third = [2, 3];
    fifth = [4, 6];
    if (/7/.test(q)) seventh = [6, 9];
  } else if (/^ø/.test(q)) {
    third = [2, 3];
    fifth = [4, 6];
    seventh = [6, 10];
  } else if (/^(aug|\+)/.test(q)) fifth = [4, 8];
  if (/sus2/.test(q)) third = [1, 2];
  else if (/sus/.test(q)) third = [3, 5];
  if (/b5|♭5|-5/.test(q)) fifth = [4, 6];
  if (/#5|♯5|\+5/.test(q) || alt) fifth = [4, 8];
  if (!seventh && (extended || major7)) seventh = major7 ? [6, 11] : [6, 10];
  if (/6/.test(q.replace(/1[0-9]/g, ""))) extra.push([5, 9]);
  // The ninth: written, altered, or under an eleventh or thirteenth that is not an addition.
  const eleven = /(^|[^\d])11/.test(q);
  const thirteen = /(^|[^\d])13/.test(q);
  const upper = (eleven && !/add11/.test(q)) || (thirteen && !/add13/.test(q));
  const flat9 = /[b♭]9/.test(q);
  const sharp9 = /[#♯]9/.test(q);
  if (alt) extra.push([8, 13], [8, 15]);
  else {
    if (flat9) extra.push([8, 13]);
    if (sharp9) extra.push([8, 15]);
    // A plain 9 (C9, C(add9), C6/9), or the one under an 11 or 13.
    if (/(^|[^#♯b♭\d])9/.test(q) || (upper && !flat9 && !sharp9)) extra.push([8, 14]);
  }
  if (eleven) extra.push(/#11|♯11/.test(q) ? [10, 18] : [10, 17]);
  if (thirteen) extra.push(/b13|♭13/.test(q) ? [12, 20] : [12, 21]);
  let tones = [third, fifth, ...(seventh ? [seventh] : []), ...extra];
  if (/omit3|no3/.test(q)) tones = tones.filter(([steps]) => steps !== 2);
  if (/omit5|no5/.test(q)) tones = tones.filter(([steps]) => steps !== 4);
  tones.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return {
    root: { step: LETTERS.indexOf(letter), alter: SIGNS[sign] ?? 0 },
    bass: bassLetter ? { step: LETTERS.indexOf(bassLetter), alter: SIGNS[bassSign] ?? 0 } : null,
    tones,
  };
}

/** A chord symbol's notes, its root in the octave starting at step `from` (7 the octave of middle C), with its bass a step below. */
export function chordVoicing(text, from = 7) {
  const chord = chordTones(text);
  if (!chord) return null;
  const root = { d: from + chord.root.step, alter: chord.root.alter };
  const pitches = [root, ...chord.tones.map(([steps, semitones]) => M.transposePitch(root, steps, semitones))];
  const bassStep = chord.bass ? chord.bass.step : chord.root.step;
  const bass = { d: from - 7 + bassStep, alter: chord.bass ? chord.bass.alter : chord.root.alter };
  return { pitches, bass, root };
}

/** A chord's notes spelled as its symbol spells them, one per pitch class: [{ d, alter, pc, role }], root first. */
function spelled(chord) {
  const root = { d: chord.root.step, alter: chord.root.alter };
  const out = [{ ...root, role: 0 }];
  for (const [steps, semitones] of chord.tones) out.push({ ...M.transposePitch(root, steps, semitones), role: steps });
  return out.map((p) => ({ ...p, pc: mod12(M.midiKey(p.d, p.alter)) }));
}

/** A pitch of pitch class `pc` (spelled like `like`) at MIDI key `key`: { d, alter }. */
function atKey(like, key) {
  const octave = Math.round((key - M.midiKey(like.d, like.alter)) / 12);
  return { d: like.d + 7 * octave, alter: like.alter };
}

/** Sounds `pitches` as MIDI keys. */
const keysOf = (pitches) => pitches.map((p) => M.midiKey(p.d, p.alter));

// ---- The guitar -------------------------------------------------------------------

/** The guitar's open strings, low E first, as MIDI keys: E2 A2 D3 G3 B3 E4. */
export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64];

// A shape is six frets, low E first: a number, or null for a string not
// played. The open chords are as guitarists learn them; the barres move up
// the neck, their frets counted from the root's on the low string (the E
// shape, root on the sixth string) or the fifth (the A shape).
const OPEN = {
  C: "x32010", Cmaj7: "x32000", C7: "x32310", Cadd9: "x32030", Csus4: "x33011", C6: "x32210",
  D: "xx0232", Dm: "xx0231", D7: "xx0212", Dm7: "xx0211", Dmaj7: "xx0222", Dsus2: "xx0230", Dsus4: "xx0233", D6: "xx0202",
  E: "022100", Em: "022000", E7: "020100", Em7: "022030", Emaj7: "021100", Esus4: "022200", E6: "022120",
  Fmaj7: "xx3210",
  G: "320003", G7: "320001", Gmaj7: "320002", G6: "320000", Gsus4: "3x0013",
  A: "x02220", Am: "x02210", A7: "x02020", Am7: "x02010", Amaj7: "x02120", Asus2: "x02200", Asus4: "x02230", A6: "x02222", Am6: "x02212",
  B7: "x21202",
};

/** Movable shapes by quality: [string of the root, frets from the root's fret]. */
const BARRES = {
  "": [["E", [0, 2, 2, 1, 0, 0]], ["A", [null, 0, 2, 2, 2, 0]]],
  m: [["E", [0, 2, 2, 0, 0, 0]], ["A", [null, 0, 2, 2, 1, 0]]],
  7: [["E", [0, 2, 0, 1, 0, 0]], ["A", [null, 0, 2, 0, 2, 0]]],
  m7: [["E", [0, 2, 0, 0, 0, 0]], ["A", [null, 0, 2, 0, 1, 0]]],
  maj7: [["E", [0, null, 1, 1, 0, null]], ["A", [null, 0, 2, 1, 2, 0]]],
  mmaj7: [["E", [0, 2, 1, 0, 0, 0]], ["A", [null, 0, 2, 1, 1, 0]]],
  sus4: [["E", [0, 2, 2, 2, 0, 0]], ["A", [null, 0, 2, 2, 3, 0]]],
  sus2: [["A", [null, 0, 2, 2, 0, 0]]],
  "7sus4": [["E", [0, 2, 0, 2, 0, 0]], ["A", [null, 0, 2, 0, 3, 0]]],
  6: [["E", [0, null, -1, 1, 0, null]], ["A", [null, 0, 2, 2, 2, 2]]],
  m6: [["E", [0, null, -1, 0, 0, null]], ["A", [null, 0, 2, 2, 1, 2]]],
  9: [["A", [null, 0, -1, 0, 0, 0]]],
  m9: [["A", [null, 0, -2, 0, 0, null]]],
  maj9: [["A", [null, 0, -1, 1, 0, null]]],
  13: [["E", [0, null, 0, 1, 2, null]], ["A", [null, 0, -1, 0, 2, 2]]],
  "7b9": [["A", [null, 0, -1, 0, -1, null]]],
  "7#9": [["A", [null, 0, -1, 0, 1, null]]],
  dim: [["E", [0, 1, 2, 0, null, null]], ["A", [null, 0, 1, 2, 1, null]]],
  dim7: [["E", [0, null, -1, 0, -1, null]], ["A", [null, 0, 1, -1, 1, null]]],
  m7b5: [["E", [0, null, 0, 0, -1, null]], ["A", [null, 0, 1, 0, 1, null]]],
  aug: [["E", [0, null, 2, 1, 1, null]], ["A", [null, 0, 3, 2, 2, null]]],
};

/** A shape typed as guitarists write it ("x32010"): its frets. */
const fretsOf = (typed) => [...typed].map((c) => (c === "x" ? null : Number(c)));

/** The quality a symbol is played as, reduced to the shapes there are: "", "m", "7", "m7b5"… */
function quality(chord) {
  const has = (steps, semis) => chord.tones.some(([s, t]) => s === steps && t === semis);
  const sus2 = has(1, 2);
  const sus4 = has(3, 5);
  const minor = has(2, 3);
  const flat5 = has(4, 6);
  const sharp5 = has(4, 8);
  const dim7 = has(6, 9);
  const b7 = has(6, 10);
  const maj7 = has(6, 11);
  const sixth = has(5, 9);
  const nine = has(8, 14);
  const b9 = has(8, 13);
  const s9 = has(8, 15);
  const thirteen = has(12, 21);
  if (minor && flat5) return dim7 ? "dim7" : b7 ? "m7b5" : "dim";
  if (sharp5 && !b7 && !maj7) return "aug";
  if (sus4) return b7 ? "7sus4" : "sus4";
  if (sus2) return "sus2";
  if (minor) return maj7 ? "mmaj7" : b7 ? (nine ? "m9" : "m7") : sixth ? "m6" : "m";
  if (maj7) return nine ? "maj9" : "maj7";
  if (b7) return thirteen ? "13" : b9 ? "7b9" : s9 ? "7#9" : nine ? "9" : "7";
  if (sixth) return "6";
  return nine ? "add9" : "";
}

/** Each quality's fallback, when no shape plays it: the chord with less on it. */
const SIMPLER = { add9: "", "13": "7", "7b9": "7", "7#9": "7", "9": "7", m9: "m7", maj9: "maj7", mmaj7: "m", "7sus4": "sus4", m6: "m", 6: "", aug: "", dim7: "dim", sus2: "" };

/**
 * A guitar shape for chord symbol `text`: { frets, barre, name } — six frets
 * from the low E (null: not played), the barre as `[fret, from string, to
 * string]` (strings numbered 6 to 1) or null, and the name of the shape
 * played (the symbol, or the chord with less on it when no shape plays it
 * all). The open chord when there is one, else the lowest barre; a slash
 * chord's bass on the lowest string that reaches it. Null for what is not a
 * chord symbol.
 */
export function guitarShape(text) {
  const chord = chordTones(text);
  if (!chord) return null;
  const rootPc = mod12(M.midiKey(chord.root.step, chord.root.alter));
  let q = quality(chord);
  let shape = null;
  while (!shape) {
    shape = openShape(rootPc, q) ?? barreShape(rootPc, q);
    if (shape || !(q in SIMPLER)) break;
    q = SIMPLER[q];
  }
  if (!shape) return null;
  const bass = chord.bass ? mod12(M.midiKey(chord.bass.step, chord.bass.alter)) : null;
  if (bass != null && bass !== rootPc) shape = withBass(shape, bass);
  const name = LETTERS[chord.root.step] + ({ 1: "#", "-1": "b" }[chord.root.alter] ?? "") + q;
  return { ...shape, name };
}

/** The open chord for root pitch class `pc` and quality `q`, or null. */
function openShape(pc, q) {
  for (const [name, typed] of Object.entries(OPEN)) {
    const letter = name[0];
    const rest = name.slice(1);
    if (rest !== q || mod12(M.midiKey(LETTERS.indexOf(letter), 0)) !== pc) continue;
    return { frets: fretsOf(typed), barre: null };
  }
  return null;
}

/** The lowest barre for root pitch class `pc` and quality `q`, or null. */
function barreShape(pc, q) {
  const options = [];
  for (const [string, rel] of BARRES[q] ?? []) {
    const open = string === "E" ? 40 : 45;
    // The root's fret on that string, lowest first; a shape reaching below the nut moves an octave up.
    let fret = mod12(pc - open);
    const low = Math.min(...rel.filter((f) => f != null));
    if (fret + low < 0) fret += 12;
    if (fret + low === 0 && fret === 0) {
      // At the nut: an open shape, its "barre" the nut itself.
      options.push({ frets: rel.map((f) => (f == null ? null : f)), barre: null, top: Math.max(...rel.filter((f) => f != null)) });
      continue;
    }
    const frets = rel.map((f) => (f == null ? null : fret + f));
    // The barre: the root's fret, across the strings the shape holds there, from the root's string.
    const strings = frets.map((f, k) => (f === fret ? 6 - k : null)).filter((n) => n != null);
    const barre = fret > 0 && strings.length > 1 ? [fret, Math.max(...strings), Math.min(...strings)] : null;
    options.push({ frets, barre, top: Math.max(...frets.filter((f) => f != null)) });
  }
  if (!options.length) return null;
  options.sort((x, y) => x.top - y.top);
  const { frets, barre } = options[0];
  return { frets, barre };
}

/** A shape with pitch class `bass` under it: on the lowest string that reaches it within the shape's span, the strings under it silent. */
function withBass(shape, bass) {
  const played = shape.frets.filter((f) => f != null && f > 0);
  const lo = played.length ? Math.min(...played) : 0;
  const hi = played.length ? Math.max(...played) : 3;
  for (let k = 0; k < 3; k++) {
    if (shape.frets.slice(0, k).some((f) => f != null) && k > 0 && shape.frets[k] == null) continue;
    for (const fret of [0, ...Array.from({ length: 5 }, (_, n) => Math.max(1, lo - 1) + n)]) {
      if (fret > 0 && (fret < lo - 1 || fret > Math.max(hi, lo + 3))) continue;
      if (mod12(GUITAR_TUNING[k] + fret) !== bass) continue;
      const frets = shape.frets.map((f, j) => (j < k ? null : j === k ? fret : f));
      // The bass must stand under every other note played.
      const keys = frets.map((f, j) => (f == null ? null : GUITAR_TUNING[j] + f));
      if (keys.slice(k + 1).some((key) => key != null && key <= keys[k])) continue;
      const barre = shape.barre && shape.barre[1] > 6 - k ? [shape.barre[0], 6 - k, shape.barre[2]] : shape.barre;
      return { frets, barre };
    }
  }
  return shape;
}

/** A shape as a chord diagram's spec (M.fretSpec): "x;3;2;o;1;o;", its barre after a "|". */
export function fretSpecOf(shape) {
  const frets = shape.frets.map((f) => (f == null ? "x" : f === 0 ? "o" : String(f))).join(";") + ";";
  return shape.barre ? `${frets}|${shape.barre[1]}-${shape.barre[2]}-${shape.barre[0]}` : frets;
}

/** The notes a shape sounds, low to high, spelled as chord symbol `text` spells them: [{ d, alter }]. */
export function guitarPitches(text, shape = guitarShape(text)) {
  const chord = chordTones(text);
  if (!chord || !shape) return [];
  const names = spelled(chord);
  if (chord.bass) names.push({ d: chord.bass.step, alter: chord.bass.alter, pc: mod12(M.midiKey(chord.bass.step, chord.bass.alter)) });
  return shape.frets
    .map((f, k) => (f == null ? null : GUITAR_TUNING[k] + f))
    .filter((key) => key != null)
    .map((key) => {
      const like = names.find((n) => n.pc === mod12(key)) ?? M.pitchOfKey(key, 0);
      return atKey(like, key);
    });
}

// ---- The piano --------------------------------------------------------------------

/** Where the right hand plays: from G3 to A5, centred on middle C's octave. */
const RH_LOW = 55;
const RH_HIGH = 81;
const RH_CENTRE = 67;
/** Where the left hand's bass goes: from C2 to C4. */
const LH_LOW = 36;
const LH_HIGH = 60;
const LH_CENTRE = 45;

/**
 * The piano's two hands for chord symbol `text`: { lh, rh }, spelled.
 * The left hand holds the bass (the slash's, else the root) and, with
 * `style` "open", its fifth or, "shell", its seventh — a jazz pianist's
 * shell. The right hand holds the rest, four notes at most (the fifth left
 * out first, then the root), in the inversion nearest the right hand of
 * `previous` (a voicing this answered), so the voices move as little as
 * they can; from the middle of the keyboard when there is none.
 */
export function pianoVoicing(text, previous = null, { style = "open" } = {}) {
  const chord = chordTones(text);
  if (!chord) return null;
  const names = spelled(chord);
  const bassName = chord.bass ? { d: chord.bass.step, alter: chord.bass.alter } : names[0];
  const bassKey = nearest(mod12(M.midiKey(bassName.d, bassName.alter)), previous ? keysOf(previous.lh)[0] : LH_CENTRE, LH_LOW, LH_HIGH);
  const lh = [atKey(bassName, bassKey)];
  const seventh = names.find((n) => n.role === 6);
  if (style === "shell" && seventh) lh.push(atKey(seventh, bassKey + mod12(seventh.pc - bassKey) || 12));
  else if (style !== "bass") {
    const fifth = names.find((n) => n.role === 4);
    if (fifth) lh.push(atKey(fifth, bassKey + mod12(fifth.pc - bassKey)));
  }
  // The right hand: the chord less its bass's doublings, four at most.
  let hand = names.filter((n) => !(style === "shell" && n.role === 6));
  if (hand.length > 4) hand = hand.filter((n) => n.role !== 4);
  if (hand.length > 4) hand = hand.filter((n) => n.role !== 0);
  if (hand.length > 4) hand = hand.slice(0, 4);
  const rh = closest(hand, previous ? keysOf(previous.rh) : null);
  return { lh, rh };
}

/** The key of pitch class `pc` nearest `near`, within `low`…`high`. */
function nearest(pc, near, low, high) {
  let best = null;
  for (let key = low; key <= high; key++) {
    if (mod12(key) !== pc) continue;
    if (best == null || Math.abs(key - near) < Math.abs(best - near)) best = key;
  }
  return best ?? low + mod12(pc - low);
}

/**
 * Notes `hand` in close position, each inversion in each octave of the
 * right hand's range: the one moving least from keys `from` (each note to
 * its nearest), or nearest the centre when there is no `from`.
 */
function closest(hand, from) {
  let best = null;
  for (let first = 0; first < hand.length; first++) {
    const order = [...hand.slice(first), ...hand.slice(0, first)];
    for (let start = RH_LOW; start < RH_LOW + 12; start++) {
      if (mod12(start) !== order[0].pc) continue;
      for (let octave = 0; octave < 3; octave++) {
        const keys = [];
        let key = start + 12 * octave;
        for (const n of order) {
          while (mod12(key) !== n.pc) key++;
          keys.push(key);
          key++;
        }
        if (keys.at(-1) > RH_HIGH || keys[0] < RH_LOW) continue;
        const cost = from
          ? keys.reduce((sum, k) => sum + Math.min(...from.map((f) => Math.abs(f - k))), 0) + from.reduce((sum, f) => sum + Math.min(...keys.map((k) => Math.abs(f - k))), 0)
          : Math.abs(keys.reduce((a, b) => a + b, 0) / keys.length - RH_CENTRE);
        if (!best || cost < best.cost) best = { cost, notes: order.map((n, k) => atKey(n, keys[k])) };
      }
    }
  }
  return best ? best.notes : [];
}

// ---- The bass ---------------------------------------------------------------------

/** A bass guitar's range, sounding: E1 to G3. */
export const BASS_LOW = 28;
export const BASS_HIGH = 55;
/** Where a bass line sits most: around A1–A2. */
const BASS_CENTRE = 38;

/**
 * The bass's note for chord symbol `text`: its `role` — "root" (the slash's
 * bass when there is one), "fifth", "third", "octave" (the root an octave
 * up, when it fits) — in the bass's range, nearest `previous` (a pitch), or
 * around A1–A2 when there is none. Null for what is not a chord symbol.
 */
export function bassNote(text, role = "root", previous = null) {
  const chord = chordTones(text);
  if (!chord) return null;
  const names = spelled(chord);
  const root = chord.bass && role === "root" ? { d: chord.bass.step, alter: chord.bass.alter } : names[0];
  // Near the note before, drawn back towards the middle of the bass's range so a line does not climb away.
  const near = previous ? (2 * M.midiKey(previous.d, previous.alter) + BASS_CENTRE) / 3 : BASS_CENTRE;
  const rootKey = nearest(mod12(M.midiKey(root.d, root.alter)), near, BASS_LOW, BASS_HIGH);
  if (role === "root") return atKey(root, rootKey);
  if (role === "octave") return atKey(root, rootKey + 12 <= BASS_HIGH ? rootKey + 12 : rootKey - 12);
  const steps = role === "fifth" ? 4 : 2;
  const tone = names.find((n) => n.role === steps) ?? names[0];
  const up = rootKey + mod12(tone.pc - rootKey);
  return atKey(tone, up <= BASS_HIGH ? up : up - 12);
}

/**
 * The note leading into chord symbol `next` from pitch `from`: a semitone
 * under the next root when `from` is below it, over it when above — the
 * bass's approach note. Null when `next` is not a chord symbol.
 */
export function approachNote(next, from) {
  const target = bassNote(next, "root", from);
  if (!target) return null;
  const key = M.midiKey(target.d, target.alter);
  const below = !from || M.midiKey(from.d, from.alter) <= key;
  const step = below ? (key - 1 >= BASS_LOW ? -1 : 1) : key + 1 <= BASS_HIGH ? 1 : -1;
  return M.pitchOfKey(key + step, step < 0 ? 1 : -1);
}

// ---- Chords on the score ----------------------------------------------------------

/** The chord symbols of the score, on any staff, by time: [{ t, text, lane }], one per time. */
export function chordSymbols(score) {
  const out = [];
  for (const [s, staff] of score.staves.entries()) {
    const at = M.starts(staff);
    staff.events.forEach((ev, i) => {
      if (ev.chord && M.isChordSymbol(ev.chord) && !out.some((c) => c.t === at[i])) out.push({ t: at[i], text: ev.chord.trim(), lane: s });
    });
  }
  return out.sort((x, y) => x.t - y.t);
}

/** The chord symbol sounding at time `t` (ticks): the last one at or before it, or null. */
export function chordAt(score, t) {
  return chordSymbols(score).filter((c) => c.t <= t).at(-1)?.text ?? null;
}

/**
 * A chord diagram, in its shape, over the first note of each chord symbol
 * on lane `s` (a staff of notes) in bars `a` to `b`: the one sounding where
 * the symbol is. A note that already has a diagram keeps it. Answers how
 * many were put.
 */
export function diagramsFromSymbols(score, s, { a = 0, b = null } = {}) {
  const staff = score.staves[s];
  if (!staff) throw new Error(tr("no such staff"));
  if (M.isDrums(score, s)) throw new Error(tr("A drum staff takes no chord diagrams: choose a staff of notes"));
  const t0 = M.barStart(score, a);
  const t1 = M.barStart(score, (b ?? M.barsOf(score) - 1) + 1);
  const at = M.starts(staff);
  let count = 0;
  for (const c of chordSymbols(score).filter((x) => x.t >= t0 && x.t < t1)) {
    // The note sounding there: the one starting at it, else the first after it, before the next symbol.
    const i = staff.events.findIndex((ev, k) => at[k] >= c.t && !ev.rest);
    if (i < 0 || at[i] >= t1) continue;
    const ev = staff.events[i];
    if (ev.fret) continue;
    const shape = guitarShape(c.text);
    if (!shape) continue;
    ev.fret = fretSpecOf(shape);
    count++;
  }
  if (!count) throw new Error(tr("No chord symbol there has a note under it on that staff: add chord symbols with Insert ▸ Chord symbol (Ctrl+K)"));
  return count;
}
