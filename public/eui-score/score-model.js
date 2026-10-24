// The editor's model of a score, and every edit made on it.
//
// A score is staves of events — notes, chords and rests — each with its
// written value (base and dots), its tuplet, ties, slurs, dynamics,
// articulations, chord symbol and lyric syllable. The LilyPond text is
// written from it (`toLilyPond`), in absolute pitches, and read back into it
// from what eui-score's parser understood (`fromParsed`).
//
// One rule holds the model together: an event never crosses a bar line,
// and every staff is the same whole number of bars long. Writing a note
// longer than what is left of its bar writes it as tied pieces, as an
// engraver would, so the person thinks in durations and not in bars. Notes
// are written over what is there, as in MuseScore: a rest or a note is
// replaced, never pushed along, so a bar can never overflow.
//
// No DOM here: the page's editor calls these functions, and so do the
// tests (tests/js/score_model.test.mjs).

/** Ticks in a whole note, as eui-score counts them: a dotted 128th, and any of them in a triplet, quintuplet, sextuplet or septuplet — or a triplet in a triplet — is a whole number. */
export const WHOLE = 80640;

/** A quarter's speed when the source sets none: 100, on Play, in a saved MIDI file and in the embed alike. */
export const DEFAULT_BPM = 100;

const NAMES = ["c", "d", "e", "f", "g", "a", "b"];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const SHARPS = [3, 0, 4, 1, 5, 2, 6];
const CLEFS = ["treble", "bass", "alto", "tenor", "treble_8", "bass_8", "soprano", "percussion"];
const SCRIPTS = {
  staccato: "-.", accent: "->", tenuto: "--", marcato: "-^", staccatissimo: "-!", portato: "-_", fermata: "\\fermata",
  trill: "\\trill", prall: "\\prall", mordent: "\\mordent", turn: "\\turn",
  // Bowings, a harmonic's circle and the espressivo (Soli 2.28.5).
  upbow: "\\upbow", downbow: "\\downbow", flageolet: "\\flageolet", espressivo: "\\espressivo",
};
/** A breath mark after a note or rest: `\\breathe` (a comma) or `\\caesura` (//). */
export const BREATHS = ["breathe", "caesura"];
/** A crescendo or diminuendo written as words with a dashed line: `\\cresc`, `\\dim`, `\\decresc`. */
const HAIRPIN_WORDS = ["cresc", "dim", "decresc"];
/** The kinds of grace notes: slashed and slurred, slurred, plain, slashed. */
export const GRACES = ["acciaccatura", "appoggiatura", "grace", "slashedGrace"];
/** A tremolo's strokes: the note repeated in eighths, sixteenths or thirty-seconds. */
export const TREMOLOS = [8, 16, 32];
export const DYNAMICS = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "sf", "sfz", "fp", "rfz"];
export const ARTICULATIONS = Object.keys(SCRIPTS);
/** Values, longest first, with their dots, a written duration may take. */
const VALUES = [1, 2, 4, 8, 16, 32, 64, 128].flatMap((base) => [2, 1, 0].map((dots) => ({ base, dots, ticks: notated(base, dots) }))).sort((a, b) => b.ticks - a.ticks);

// ---- Durations ------------------------------------------------------------

/** The ticks of a written value: `base` 1 (whole) … 128, with `dots`. */
export function notated(base, dots = 0) {
  let ticks = WHOLE / base;
  let add = ticks;
  for (let i = 0; i < dots; i++) {
    add /= 2;
    ticks += add;
  }
  return ticks;
}

/** The ticks an event lasts: its written value, scaled by its tuplet. */
export function ticksOf(ev) {
  const written = notated(ev.base, ev.dots);
  return ev.tuplet ? (written * ev.tuplet.d) / ev.tuplet.n : written;
}

// ---- Bars --------------------------------------------------------------------------
//
// Bars may change metre: `score.changes` lists, by bar (1 and on), what
// changes at its start — { bar, key, time, tempo }, each field optional — and
// a staff's `clefs` its own changes of clef, { bar, clef }. Bar 0's are the
// score's and the staff's own settings. Every bar line is found here.

/**
 * Where each metre starts: [{ bar, start, len, time }], the first at bar 0.
 * A pickup (`score.pickup`, in ticks) makes bar 0 that short, as LilyPond's
 * \\partial does: the full bars start after it, at bar 1.
 */
function metres(score) {
  const full = (WHOLE * score.time[0]) / score.time[1];
  const pickup = score.pickup > 0 && score.pickup < full ? score.pickup : 0;
  const out = pickup ? [{ bar: 0, start: 0, len: pickup, time: score.time }, { bar: 1, start: pickup, len: full, time: score.time }] : [{ bar: 0, start: 0, len: full, time: score.time }];
  for (const c of score.changes ?? []) {
    if (!c.time) continue;
    const prev = out[out.length - 1];
    out.push({ bar: c.bar, start: prev.start + (c.bar - prev.bar) * prev.len, len: (WHOLE * c.time[0]) / c.time[1], time: c.time });
  }
  return out;
}

function metreOfBar(score, b) {
  const all = metres(score);
  let k = all.length - 1;
  while (k > 0 && all[k].bar > b) k--;
  return all[k];
}

/** Bar `b`'s length in ticks (bar 0's by default). */
export function barLength(score, b = 0) {
  return metreOfBar(score, b).len;
}

/** Where bar `b` starts, in ticks. */
export function barStart(score, b) {
  const m = metreOfBar(score, b);
  return m.start + (b - m.bar) * m.len;
}

/** The bar a time (ticks) is in. */
export function barAt(score, t) {
  const all = metres(score);
  let k = all.length - 1;
  while (k > 0 && all[k].start > t + 1e-6) k--;
  return all[k].bar + Math.floor((t - all[k].start) / all[k].len + 1e-9);
}

/** The first bar line after `t`. */
export function nextBarLine(score, t) {
  return barStart(score, barAt(score, t) + 1);
}

export function isBarLine(score, t) {
  return Math.abs(barStart(score, barAt(score, t)) - t) < 1e-6;
}

/** Bar `b`'s number as the page shows it: 1 and on, or 0 and on after a pickup (its bar 0). */
export function barNumber(score, b) {
  return score.pickup > 0 ? b : b + 1;
}

/** A pickup's length in ticks from its value as \\partial writes it: "4", "8.", "8*3"; 0 for "" (none). */
export function pickupOf(text) {
  const value = String(text ?? "").trim();
  if (!value) return 0;
  const match = /^(1|2|4|8|16|32|64|128)(\.*)(?:\*(\d+))?$/.exec(value);
  if (!match) throw new Error("a pickup is a duration, like 4, 8. or 8*3");
  return notated(Number(match[1]), match[2].length) * Number(match[3] ?? 1);
}

/** A pickup's length as \\partial writes it: one value ("4."), or a count of the longest that divides it ("8*3"). */
export function pickupText(ticks) {
  const one = VALUES.find((v) => v.ticks === ticks);
  if (one) return `${one.base}${".".repeat(one.dots)}`;
  const base = [1, 2, 4, 8, 16, 32, 64, 128].find((b) => ticks % (WHOLE / b) === 0);
  if (!base) throw new Error("a pickup is a whole number of 128ths");
  return `${base}*${ticks / (WHOLE / base)}`;
}

/**
 * The first bar made a pickup `ticks` long (0: a full bar again). The bars
 * after it keep their music and their numbers in the score; a pickup is
 * the end of a bar, so a shorter one loses the start of the first bar,
 * which must be rests, and a longer one gets rests before its music.
 */
export function setPickup(score, ticks) {
  const full = (WHOLE * score.time[0]) / score.time[1];
  if (!Number.isInteger(ticks) || ticks < 0 || ticks % (WHOLE / 128) !== 0) throw new Error("a pickup is a whole number of 128ths");
  if (ticks >= full) throw new Error(`a pickup is shorter than a bar of ${score.time[0]}/${score.time[1]}`);
  const was = barLength(score, 0);
  const now = ticks || full;
  if (now === was) return;
  const work = structuredClone(score);
  work.pickup = ticks || 0;
  if (!work.pickup) delete work.pickup;
  for (const staff of work.staves) {
    if (now < was) {
      const from = cut(score, staff, was - now);
      const at = starts(staff);
      if (from !== was - now || staff.events.some((ev, k) => at[k] < from && (!ev.rest || ev.tuplet))) throw new Error("the first bar's start holds notes: a shorter pickup would lose them");
      staff.events = staff.events.filter((_, k) => at[k] >= from);
    } else {
      staff.events.unshift(...rests(work, 0, now - was));
    }
    tidy(work, staff);
  }
  if (!work.pickup) delete score.pickup;
  Object.assign(score, work);
}

/** The metre bar `b` is in. */
export function timeAt(score, b) {
  return metreOfBar(score, b).time;
}

/** What changes at the start of bar `b`, or null. */
export function changeAt(score, b) {
  return (score.changes ?? []).find((c) => c.bar === b) ?? null;
}

// A key's mode, and how far round the circle of fifths its signature is
// from its tonic's major key: \\key d \\dorian has C major's signature.
export const MODES = { major: 0, minor: -3, ionian: 0, aeolian: -3, dorian: -2, phrygian: -4, lydian: 1, mixolydian: -1, locrian: -5 };

/** A key as \\key writes it: its tonic, for `fifths` (the signature) in `mode`, then the mode — "d \\dorian". */
export function keyText(fifths, mode = "major") {
  const name = MODES[mode] == null ? "major" : mode;
  const tonic = fifths - MODES[name];
  const letter = "fcgdaeb"[(((tonic + 1) % 7) + 7) % 7];
  const accidentals = Math.floor((tonic + 1) / 7);
  return `${letter}${accidentals > 0 ? "is".repeat(accidentals) : "es".repeat(-accidentals)} \\${name}`;
}

// A key or a clef may change inside a bar: `score.midKeys` lists the score's,
// { bar, pos, key, mode }, and a staff's `midClefs` its own, { bar, pos, clef }
// — `pos` in ticks from the bar's start. Each is written before the note or
// rest that starts there (or the first after it), and holds until the next.

/** The score's key and mode in force at `pos` ticks into bar `b` (Infinity: at its end). */
function keyAtPlace(score, b, pos = 0) {
  let now = { key: score.key, mode: score.mode ?? "major", bar: -1, pos: 0 };
  const marks = [
    ...(score.changes ?? []).filter((c) => c.key != null).map((c) => ({ bar: c.bar, pos: 0, key: c.key, mode: c.mode ?? "major" })),
    ...(score.midKeys ?? []).map((m) => ({ ...m, mode: m.mode ?? "major" })),
  ];
  for (const m of marks) {
    const before = m.bar < b || (m.bar === b && m.pos <= pos);
    const later = m.bar > now.bar || (m.bar === now.bar && m.pos >= now.pos);
    if (before && later) now = m;
  }
  return now;
}

/** The mode in force in bar `b`: the score's, as its changes of key leave it. */
export function modeAt(score, b, pos = 0) {
  return keyAtPlace(score, b, pos).mode;
}

/** The score's key in bar `b` (at `pos` ticks into it), as its changes leave it. */
function scoreKeyAt(score, b, pos = 0) {
  return keyAtPlace(score, b, pos).key;
}

/** The tempo in force in bar `b`: { text, base, bpm }, or null. */
export function tempoAt(score, b) {
  let tempo = score.tempo;
  for (const c of score.changes ?? []) if (c.bar <= b && c.tempo) tempo = { ...(tempo ?? {}), ...c.tempo, text: c.tempo.text ?? "" };
  return tempo;
}

/** The clef lane `s` is in at the start of bar `b` (at `pos` ticks into it; Infinity: at its end). */
export function clefAt(score, s, b, pos = 0) {
  const staff = score.staves[upperOf(score, s)];
  let now = { clef: staff.clef, bar: -1, pos: 0 };
  const marks = [...(staff.clefs ?? []).map((c) => ({ ...c, pos: 0 })), ...(staff.midClefs ?? [])];
  for (const m of marks) {
    const before = m.bar < b || (m.bar === b && m.pos <= pos);
    const later = m.bar > now.bar || (m.bar === now.bar && m.pos >= now.pos);
    if (before && later) now = m;
  }
  return now.clef;
}

/** Field `field` of bar `b`'s change set to `value`; null takes it away. */
function setChange(score, b, field, value) {
  score.changes ??= [];
  let c = changeAt(score, b);
  if (!c) {
    if (value == null) return;
    c = { bar: b };
    score.changes.push(c);
    score.changes.sort((x, y) => x.bar - y.bar);
  }
  if (value == null) delete c[field];
  else c[field] = value;
  if (Object.keys(c).length === 1) score.changes.splice(score.changes.indexOf(c), 1);
}

/** When `t` sounds, in seconds, with the tempo changes on the way (100 a quarter when none is set). */
export function secondsAt(score, t) {
  const marks = [{ at: 0, tempo: score.tempo }, ...(score.changes ?? []).filter((c) => c.tempo?.bpm).map((c) => ({ at: barStart(score, c.bar), tempo: tempoAt(score, c.bar) }))];
  let sec = 0;
  let bpm = score.tempo?.bpm || DEFAULT_BPM;
  let base = score.tempo?.base || 4;
  let from = 0;
  for (const m of marks.slice(1)) {
    if (m.at >= t) break;
    sec += ((m.at - from) / M_TICKS(base)) * (60 / bpm);
    from = m.at;
    bpm = m.tempo.bpm || bpm;
    base = m.tempo.base || base;
  }
  return sec + ((t - from) / M_TICKS(base)) * (60 / bpm);
}

/** The time (ticks) sounding at `sec`: secondsAt backwards. */
export function ticksAtSeconds(score, sec) {
  let lo = 0;
  let hi = Math.max(WHOLE, ...score.staves.map(lengthOf));
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (secondsAt(score, mid) < sec) lo = mid;
    else hi = mid;
  }
  return lo;
}

const M_TICKS = (base) => WHOLE / base;

/** `ticks` as written values, longest first; [] when it cannot be written. */
export function spellDuration(ticks) {
  const out = [];
  let left = ticks;
  while (left > 0) {
    const value = VALUES.find((v) => v.ticks <= left);
    if (!value) return [];
    out.push({ base: value.base, dots: value.dots });
    left -= value.ticks;
  }
  return out;
}

// ---- Pitches --------------------------------------------------------------

/** The alteration the key gives each step, C to B. */
export function keyAlters(fifths) {
  const out = [0, 0, 0, 0, 0, 0, 0];
  if (fifths > 0) SHARPS.slice(0, fifths).forEach((s) => (out[s] = 1));
  if (fifths < 0) [...SHARPS].reverse().slice(0, -fifths).forEach((s) => (out[s] = -1));
  return out;
}

const mod7 = (d) => ((d % 7) + 7) % 7;

/** A pitch in LilyPond, absolute: `d` counts steps from c,,, (c' is 7). */
export function spellPitch(d, alter) {
  const step = mod7(d);
  const name = NAMES[step];
  const suffix = { 1: "is", 2: "isis", "-1": step === 2 || step === 5 ? "s" : "es", "-2": step === 2 || step === 5 ? "ses" : "eses" }[alter] ?? "";
  const marks = Math.floor(d / 7);
  return name + suffix + (marks > 0 ? "'".repeat(marks) : ",".repeat(-marks));
}

/** As people read it: "F♯5". */
export function pitchName(d, alter) {
  return NAMES[mod7(d)].toUpperCase() + ({ "-2": "𝄫", "-1": "♭", 1: "♯", 2: "𝄪" }[alter] ?? "") + (Math.floor(d / 7) + 3);
}

export function midiKey(d, alter) {
  return 12 * (Math.floor(d / 7) + 4) + NATURAL[mod7(d)] + alter;
}

/** A MIDI key spelled with the key's alteration if one sounds it, else natural, else sharp going up and flat going down. */
function spellKey(fifths, key, way) {
  const pc = ((key % 12) + 12) % 12;
  const choices = [keyAlters(fifths), [0, 0, 0, 0, 0, 0, 0], Array(7).fill(way), Array(7).fill(-way)];
  for (const choice of choices) {
    for (let step = 0; step < 7; step++) {
      if ((((NATURAL[step] + choice[step] - pc) % 12) + 12) % 12 === 0) {
        const alter = choice[step];
        const octave = Math.floor((key - NATURAL[step] - alter) / 12) - 1;
        return { d: (octave - 3) * 7 + step, alter };
      }
    }
  }
  return { d: 0, alter: 0 };
}

/** A MIDI key as a pitch: spelled as key `fifths` spells it, else natural, else sharp in a sharp key and flat in a flat one. */
export function pitchOfKey(key, fifths) {
  return spellKey(fifths, key, fifths < 0 ? -1 : 1);
}

/** A pitch moved: `how` is "step" (in the key), "semitone" or "octave". */
export function movePitch(p, how, by, fifths) {
  if (how === "octave") return { d: p.d + 7 * Math.sign(by), alter: p.alter };
  if (how === "semitone") return spellKey(fifths, midiKey(p.d, p.alter) + Math.sign(by), Math.sign(by));
  const d = p.d + Math.sign(by);
  return { d, alter: keyAlters(fifths)[mod7(d)] };
}

// ---- Transposing ------------------------------------------------------------------------------

/** The intervals the editor transposes by: how many letters, how many semitones. */
export const INTERVALS = [
  { name: "minor second", steps: 1, semitones: 1 },
  { name: "major second", steps: 1, semitones: 2 },
  { name: "minor third", steps: 2, semitones: 3 },
  { name: "major third", steps: 2, semitones: 4 },
  { name: "perfect fourth", steps: 3, semitones: 5 },
  { name: "augmented fourth", steps: 3, semitones: 6 },
  { name: "perfect fifth", steps: 4, semitones: 7 },
  { name: "minor sixth", steps: 5, semitones: 8 },
  { name: "major sixth", steps: 5, semitones: 9 },
  { name: "minor seventh", steps: 6, semitones: 10 },
  { name: "major seventh", steps: 6, semitones: 11 },
  { name: "octave", steps: 7, semitones: 12 },
];

const mod12 = (n) => ((n % 12) + 12) % 12;

/** A pitch moved by `steps` letters and `semitones`; respelled only past a double sharp or flat. */
export function transposePitch(p, steps, semitones) {
  const d = p.d + steps;
  const key = midiKey(p.d, p.alter) + semitones;
  const alter = key - midiKey(d, 0);
  if (alter >= -2 && alter <= 2) return { d, alter };
  return spellKey(0, key, Math.sign(semitones) || 1);
}

/** How far round the circle of fifths an interval moves a key: the nearest way. */
function fifthsOf(steps, semitones) {
  for (const f of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
    if (mod7(f * 4) === mod7(steps) && mod12(f * 7) === mod12(semitones)) return f;
  }
  return 0;
}

/**
 * Transposes by `steps` letters and `semitones` (negative: down) — lane `s`'s
 * events `a`…`b`, or, with no `s`, the whole score with its keys and its
 * chord symbols. A key pushed past seven sharps or flats is read as its
 * enharmonic twin (D♯ major as E♭), and the notes are spelled to match it.
 */
export function transpose(score, { steps, semitones, s = null, a = 0, b = Infinity }) {
  if (s == null) {
    let f = fifthsOf(steps, semitones);
    const to = score.key + f;
    if (Math.abs(to) > 7) {
      // The twin twelve fifths round is one letter over: up a letter when it
      // takes sharps away, down one when it takes flats away.
      const twin = f - 12 * Math.sign(to);
      steps += Math.sign(to);
      f = twin;
    }
    const clamp = (k) => Math.max(-7, Math.min(7, k));
    score.key = clamp(score.key + f);
    for (const staff of score.staves) if (staff.key != null) staff.key = clamp(staff.key + f);
    for (const c of score.changes ?? []) if (c.key != null) c.key = clamp(c.key + f);
    for (const m of score.midKeys ?? []) m.key = clamp(m.key + f);
  }
  if (s != null) refuseDrums(score, s);
  const lanes = (s == null ? score.staves.map((_, k) => k) : [s]).filter((lane) => !isDrums(score, lane));
  for (const lane of lanes) {
    const events = score.staves[lane].events;
    events.forEach((ev, i) => {
      if (s != null && (i < a || i > b)) return;
      if (!ev.rest) {
        const moved = ev.pitches.map((p) => transposePitch(p, steps, semitones));
        followHeads(ev, ev.pitches, moved);
        ev.pitches = moved;
      }
      for (const g of ev.graces) g.pitches = g.pitches.map((p) => transposePitch(p, steps, semitones));
      if (s == null && ev.chord) ev.chord = transposeChord(ev.chord, steps, semitones);
    });
  }
}

// A chord symbol: a root, a quality, a sixth to a thirteenth (or 6/9), then
// any alterations and additions, bare or in brackets, and a bass. C, Am7,
// Cmaj7, C7b9, Cm7b5, C7#11, C(add9), Cm(maj7), C7(b9,#11), Csus4, C7sus4,
// Cdim7, Cø7, C6/9, C/E, Bb13/Ab. A plain word ("Do", "Bad") is not one.
const CHORD_STEP = String.raw`(?:sus[24]?|add\d{1,2}|maj\d{1,2}|omit\d|alt|[#♯b♭+-]\d{1,2})`;
const CHORD_BRACKETED = String.raw`\((?:${CHORD_STEP}|\d{1,2})(?:[,\s]+(?:${CHORD_STEP}|\d{1,2}))*\)`;
const CHORD_SYMBOL = new RegExp(
  String.raw`^[A-G][#b♯♭]?(?:maj|min|m|M|dim|aug|sus|add|°|ø|Δ|\+|-)?(?:6\/9|\d{1,2})?(?:${CHORD_STEP}|${CHORD_BRACKETED})*(?:\/[A-G][#b♯♭]?)?$`,
);

/** Whether `text` reads as a chord symbol (see CHORD_SYMBOL). */
export function isChordSymbol(text) {
  return CHORD_SYMBOL.test(String(text).trim());
}

/** A chord symbol's root and bass moved: "F#m7/C#" up a major second is "G#m7/D#"; "C7b9" keeps its "7b9". */
export function transposeChord(text, steps, semitones) {
  const letter = (name, sign) => {
    const p = transposePitch({ d: 7 + "CDEFGAB".indexOf(name), alter: { "#": 1, "♯": 1, b: -1, "♭": -1 }[sign] ?? 0 }, steps, semitones);
    return "CDEFGAB"[mod7(p.d)] + ({ 1: "#", 2: "##", "-1": "b", "-2": "bb" }[p.alter] ?? "");
  };
  return text.replace(/^([A-G])([#♯b♭]?)/, (_, name, sign) => letter(name, sign)).replace(/\/([A-G])([#♯b♭]?)/, (_, name, sign) => "/" + letter(name, sign));
}

/** The pitch of step `step` (0 = C … 6 = B) nearest `near`, as the key alters it. */
export function nearestPitch(step, near, fifths) {
  const base = near - mod7(near) + step;
  const d = [base - 7, base, base + 7].reduce((best, x) => (Math.abs(x - near) < Math.abs(best - near) ? x : best));
  return { d, alter: keyAlters(fifths)[mod7(d)] };
}

const sortPitches = (pitches) => [...pitches].sort((a, b) => a.d - b.d || a.alter - b.alter);
const reachable = (p) => p.d >= -7 && p.d <= 42 && midiKey(p.d, p.alter) >= 21 && midiKey(p.d, p.alter) <= 108;

// ---- The score --------------------------------------------------------------

let ids = 1;
function newId() {
  return ids++;
}

/** A rest or note with nothing on it. */
export function makeEvent(fields = {}) {
  return {
    id: newId(), rest: true, pitches: [], base: 4, dots: 0, tuplet: null, tie: false, slurStart: false, slurEnd: false,
    dynamic: null, hairpin: null, hairpinEnd: false, arts: [], chord: "", texts: [], lyric: null,
    graces: [], grace: null, arpeggio: false, gliss: false, tremolo: 0, pedalOn: false, pedalOff: false, verses: [], ...fields,
  };
}

function cloneEvent(ev, fields = {}) {
  return makeEvent({ ...structuredClone({ ...ev, id: undefined }), ...fields, id: newId() });
}

/** Rests filling `ticks` from `at`, cut at the bar lines; `spacer`: rests that are not drawn (`s`). */
function rests(score, at, ticks, spacer = false) {
  const out = [];
  let t = at;
  const end = at + ticks;
  while (t < end - 1e-6) {
    const piece = Math.min(end, nextBarLine(score, t)) - t;
    for (const v of spellDuration(piece)) out.push(makeEvent({ base: v.base, dots: v.dots, ...(spacer ? { spacer: true } : {}) }));
    t += piece;
  }
  return out;
}

export function emptyStaff(score, fields = {}) {
  return { name: "", short: "", instrument: "acoustic grand", clef: "treble", events: rests(score, 0, barStart(score, barsOf(score))), ...fields };
}

/** A new score: one staff of four empty bars. */
export function newScore(fields = {}) {
  const score = { header: { title: "Untitled", composer: "" }, key: 0, time: [4, 4], tempo: null, group: "none", staves: [], repeats: [], ...fields };
  score.staves.push({ name: "", short: "", instrument: "acoustic grand", clef: "treble", events: rests(score, 0, barStart(score, 4)) });
  return score;
}

// The scores "New" starts from: their staves, by instrument name (a
// staff's own name when it differs), and how the staves are grouped.
// A piano is two staves in a brace, the piano's name on the brace;
// `about` says what the template holds when its staves' names do not.
const PIANO = [{ instrument: "Piano", clef: "treble", piano: true }, { instrument: "Piano", clef: "bass", piano: true }];
export const TEMPLATES = [
  { id: "blank", name: "Blank", about: "One empty staff", staves: [{ instrument: "Piano", clef: "treble", unnamed: true }], group: "none" },
  { id: "piano", name: "Piano", about: "Two staves in a brace", staves: PIANO, group: "none" },
  { id: "voice-piano", name: "Voice and piano", staves: [{ instrument: "Voice" }, ...PIANO], group: "none" },
  { id: "lead-sheet", name: "Lead sheet", about: "A melody, for chord symbols and lyrics", staves: [{ instrument: "Voice", name: "Melody", short: "", unnamed: true }], group: "none" },
  { id: "satb", name: "Choir (SATB)", staves: [{ instrument: "Soprano" }, { instrument: "Alto" }, { instrument: "Tenor" }, { instrument: "Bass" }], group: "choir" },
  { id: "satb-piano", name: "Choir and piano", staves: [{ instrument: "Soprano" }, { instrument: "Alto" }, { instrument: "Tenor" }, { instrument: "Bass" }, ...PIANO], group: "none", choir: [0, 3] },
  { id: "string-quartet", name: "String quartet", staves: [{ instrument: "Violin", name: "Violin I", short: "Vl. I" }, { instrument: "Violin", name: "Violin II", short: "Vl. II" }, { instrument: "Viola" }, { instrument: "Cello" }], group: "bracket" },
  { id: "wind-quintet", name: "Wind quintet", staves: [{ instrument: "Flute" }, { instrument: "Oboe" }, { instrument: "Clarinet in B♭" }, { instrument: "Horn in F" }, { instrument: "Bassoon" }], group: "bracket" },
  { id: "guitar", name: "Guitar", about: "Treble clef an octave down", staves: [{ instrument: "Guitar" }], group: "none" },
  { id: "band", name: "Rock band", staves: [{ instrument: "Voice" }, { instrument: "Electric guitar" }, { instrument: "Bass guitar" }, { instrument: "Drum kit" }], group: "bracket" },
  { id: "drums", name: "Drum kit", about: "One drum staff, General MIDI kit", staves: [{ instrument: "Drum kit" }], group: "none" },
];

/**
 * A new score from template `id`, with its settings: title, composer,
 * key (fifths), time ([n, d]), bpm (0 for none), bars, and a pickup (ticks,
 * 0 for none): a short bar before the `bars` full ones.
 */
export function fromTemplate(id, { title = "Untitled", composer = "", key = 0, time = [4, 4], bpm = 0, bars = 8, pickup = 0 } = {}) {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error("no such template");
  if (!Number.isInteger(bars) || bars < 1 || bars > 500) throw new Error("a score has 1 to 500 bars");
  if (!Number.isInteger(key) || key < -7 || key > 7) throw new Error("no such key");
  // A drum kit alone has no key.
  const drumsOnly = template.staves.every((spec) => spec.instrument === "Drum kit");
  const score = { header: { title: title || "Untitled", composer }, key: drumsOnly ? 0 : key, time, tempo: bpm > 0 ? { text: "", base: 4, bpm } : null, group: template.group, groups: [], staves: [], repeats: [], changes: [] };
  if (pickup) {
    if (!Number.isInteger(pickup) || pickup < 0 || pickup >= (WHOLE * time[0]) / time[1]) throw new Error(`a pickup is shorter than a bar of ${time[0]}/${time[1]}`);
    score.pickup = pickup;
  }
  const length = barStart(score, pickup ? bars + 1 : bars);
  template.staves.forEach((spec) => {
    const it = INSTRUMENTS.find((x) => x.name === spec.instrument);
    const named = !spec.unnamed && !spec.piano && template.staves.length > 1;
    const staff = { name: named ? spec.name ?? it.name : "", short: named ? spec.short ?? it.short : "", instrument: it.drums ? "" : it.sound, clef: spec.clef ?? it.clef ?? "treble", events: rests(score, 0, length) };
    if (it.drums) staff.drums = true;
    score.staves.push(staff);
  });
  const first = template.staves.findIndex((spec) => spec.piano);
  if (first >= 0) {
    const name = template.staves.length > 2 ? "Piano" : "";
    score.groups.push({ kind: "brace", first, last: first + 1, name, short: name ? "Pno." : "" });
  }
  if (template.choir) score.groups.push({ kind: "choir", first: template.choir[0], last: template.choir[1], name: "", short: "" });
  return score;
}

/** Each event's start in ticks. */
export function starts(staff) {
  let t = 0;
  return staff.events.map((ev) => {
    const at = t;
    t += ticksOf(ev);
    return at;
  });
}

export function lengthOf(staff) {
  return staff.events.reduce((sum, ev) => sum + ticksOf(ev), 0);
}

export function barsOf(score) {
  const first = score.staves[0];
  return first ? barAt(score, lengthOf(first)) : 4;
}

/** The index of the event that starts at `t`, or −1. */
export function eventAt(staff, t) {
  return starts(staff).indexOf(t);
}

/** The first and last index of the tuplet event `index` is in. */
function tupletBounds(staff, index) {
  const id = staff.events[index]?.tuplet?.id;
  if (id == null) return [index, index];
  let a = index;
  let b = index;
  while (a > 0 && staff.events[a - 1].tuplet?.id === id) a--;
  while (b < staff.events.length - 1 && staff.events[b + 1].tuplet?.id === id) b++;
  return [a, b];
}

/** Makes `t` an event boundary; the start of the tuplet it falls in when it falls in one. */
function cut(score, staff, t) {
  const at = starts(staff);
  for (let i = 0; i < staff.events.length; i++) {
    const ev = staff.events[i];
    const end = at[i] + ticksOf(ev);
    if (t <= at[i] || t >= end) continue;
    if (ev.tuplet) return at[tupletBounds(staff, i)[0]];
    const first = pieces(score, ev, at[i], t - at[i], "head");
    const second = pieces(score, ev, t, end - t, "tail");
    staff.events.splice(i, 1, ...first, ...second);
    return t;
  }
  return t;
}

/**
 * An event's content laid over `ticks` from `at`, as tied pieces cut at bar
 * lines. `role` says which part of the event this is: "whole", its "head"
 * (a tail follows, so it ends tied) or its "tail". What belongs to a note's
 * start — slur start, dynamic, articulations, chord symbol, words, syllable —
 * stays on the first piece of a whole or a head; what belongs to its end
 * on the last piece of a whole or a tail.
 */
function pieces(score, ev, at, ticks, role) {
  const out = [];
  let t = at;
  const end = at + ticks;
  while (t < end - 1e-6) {
    const piece = Math.min(end, nextBarLine(score, t)) - t;
    for (const v of spellDuration(piece)) out.push(cloneEvent(ev, { base: v.base, dots: v.dots, tuplet: null }));
    t += piece;
  }
  const keepsStart = role !== "tail";
  const keepsEnd = role !== "head";
  out.forEach((p, k) => {
    const last = k === out.length - 1;
    p.tie = !p.rest && (last ? (role === "head" ? true : Boolean(ev.tie)) : true);
    if (!(k === 0 && keepsStart)) {
      delete p.beamStart;
      // An ottava starts, a fingering stands, a phrase begins on the first piece only;
      // so do a switch of stems or beaming, a text span, a reminder accidental, a tie repeated.
      delete p.ottava;
      delete p.fingers;
      delete p.phraseStart;
      delete p.stemDir;
      delete p.noAutoBeam;
      delete p.spanStart;
      delete p.forced;
      delete p.cautionary;
      delete p.repeatTie;
      delete p.hairpinWords;
    }
    if (!(last && keepsEnd)) {
      delete p.beamEnd;
      delete p.phraseEnd;
      // A breath is taken, a tie let ring, a text span ended after the last piece.
      delete p.breath;
      delete p.lv;
      delete p.spanEnd;
    }
    if (!(k === 0 && keepsStart)) Object.assign(p, { slurStart: false, dynamic: null, hairpin: null, arts: [], chord: "", texts: [], lyric: null, verses: [], graces: [], grace: null, arpeggio: false, pedalOn: false, pedalOff: false });
    if (!(last && keepsEnd)) Object.assign(p, { slurEnd: false, hairpinEnd: false, gliss: false });
    // A tremolo's strokes are shorter than the note they repeat.
    if (p.tremolo && p.tremolo <= p.base) p.tremolo = 0;
  });
  return out;
}

/** Every staff made `ticks` long at least, in whole bars of rests. */
export function ensureLength(score, ticks) {
  const want = ticks > 0 ? nextBarLine(score, ticks - 1) : 0;
  for (const staff of score.staves) {
    const have = lengthOf(staff);
    if (have < want) staff.events.push(...rests(score, have, want - have));
  }
}

/**
 * Writes `content` (a note or rest, without its duration) over `ticks` from
 * `t` in staff `s`: what was there is replaced, the rest of a cut event kept
 * as a rest, a note longer than its bar tied across. Answers the index of
 * the first event written.
 */
export function write(score, s, t, ticks, content, { tidyUp = true } = {}) {
  const staff = score.staves[s];
  if (!staff) throw new Error("no such staff");
  if (!Number.isInteger(t) || t < 0 || !Number.isInteger(ticks) || ticks <= 0) throw new Error("nothing to write there");
  ensureLength(score, t + ticks);
  const from = cut(score, staff, t);
  cut(score, staff, t + ticks);
  // From the event at `from`, every event up to `t + ticks` — a tuplet in
  // the way is replaced whole, so the span may end past it.
  const at = starts(staff);
  const a = at.indexOf(from);
  let b = a;
  let to = from;
  while (b < staff.events.length && to < t + ticks) {
    to = at[b] + ticksOf(staff.events[b]);
    b++;
  }
  const note = makeEvent({ ...content, tuplet: null });
  const fill = [...rests(score, from, t - from), ...pieces(score, note, t, ticks, "whole"), ...rests(score, t + ticks, to - (t + ticks))];
  // The ottava lines, the stems and the beaming over what is written over: as they were before it and after it.
  const replaced = staff.events.slice(a, b);
  const then = Object.fromEntries(Object.keys(MARKERS).map((field) => [field, markerAt(staff, b - 1, field)]));
  const lastMarkers = Object.fromEntries(Object.keys(MARKERS).map((field) => [field, replaced.findLast((ev) => ev[field] != null)?.[field]]));
  staff.events.splice(a, b - a, ...fill);
  const next = staff.events[a + fill.length];
  for (const field of Object.keys(MARKERS)) {
    if (fill[0][field] == null && lastMarkers[field] != null) fill[0][field] = lastMarkers[field];
    if (next && next[field] == null && markerAt(staff, a + fill.length - 1, field) !== then[field]) next[field] = then[field];
    tidyMarkers(staff, field);
  }
  // A note cut before `from` was tied to its tail, which is gone now.
  const before = staff.events[a - 1];
  const after = staff.events[a];
  if (before?.tie && !sameNote(before, after)) before.tie = false;
  if (tidyUp) tidy(score, staff);
  return eventAt(staff, t);
}

const sameNote = (a, b) => Boolean(a && b && !a.rest && !b.rest && a.pitches.length === b.pitches.length && a.pitches.every((p, k) => p.d === b.pitches[k].d && p.alter === b.pitches[k].alter));

/** A rest with nothing on it (a spacer may be one): what tidy merges, and a bar of rest gathers. */
export function isBareRest(ev) {
  const marked = ev.ottava != null || ev.stemDir != null || ev.noAutoBeam != null || ev.breath || ev.spanStart != null || ev.spanEnd;
  return ev.rest && !ev.tuplet && !ev.dynamic && !ev.hairpin && !ev.hairpinEnd && !ev.texts.length && !ev.chord && !ev.arts.length && !ev.pedalOn && !ev.pedalOff && !ev.beamStart && !ev.beamEnd && !marked;
}

/** Rests side by side in a bar, with nothing on them, written as few as can be. */
export function tidy(score, staff) {
  const at = starts(staff);
  const out = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    out.push(...rests(score, run.start, run.ticks, run.spacer));
    run = null;
  };
  staff.events.forEach((ev, i) => {
    const plain = isBareRest(ev);
    // Spacers run with spacers, drawn rests with drawn rests.
    const sameBar = run && barAt(score, at[i]) === barAt(score, run.start) && run.spacer === Boolean(ev.spacer);
    if (plain && sameBar) {
      run.ticks += ticksOf(ev);
      run.events.push(ev);
      return;
    }
    flush();
    if (plain) run = { start: at[i], ticks: ticksOf(ev), events: [ev], spacer: Boolean(ev.spacer) };
    else out.push(ev);
  });
  flush();
  staff.events = out;
}

// ---- Edits on one event ---------------------------------------------------------

function noteOf(score, s, i) {
  const ev = score.staves[s]?.events[i];
  if (!ev) throw new Error("no such note");
  return ev;
}

/** The notes tied to event `i`, before and after it, with it: first and last index. */
export function tiedNotes(staff, i) {
  let a = i;
  let b = i;
  while (a > 0 && staff.events[a - 1].tie && !staff.events[a - 1].rest) a--;
  while (b < staff.events.length - 1 && staff.events[b].tie && !staff.events[b + 1].rest) b++;
  return [a, b];
}

/** Event `i` given `pitches`, and every note tied to it with it: a tie joins the same pitches. */
function setPitches(score, s, i, pitches) {
  const staff = score.staves[s];
  const [a, b] = tiedNotes(staff, i);
  for (let k = a; k <= b; k++) staff.events[k].pitches = pitches.map((p) => ({ ...p }));
}

/** The pitch of the last note before event `i`, for a letter to land near. */
export function previousPitch(score, s, i) {
  const events = score.staves[s].events;
  for (let k = i - 1; k >= 0; k--) if (!events[k].rest) return events[k].pitches[0].d;
  const clef = score.staves[upperOf(score, s)].clef;
  return clef.startsWith("bass") ? 3 : clef === "alto" ? 7 : clef === "tenor" ? 5 : 13;
}

/** Event `i` moved by step, semitone or octave — one head `head` of a chord, or all. */
export function move(score, s, i, how, by, head = -1) {
  refuseDrums(score, s);
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("select a note");
  const moved = ev.pitches.map((p, k) => (head < 0 || k === head ? movePitch(p, how, by, keyOf(score, s, starts(score.staves[s])[i])) : p));
  if (!moved.every(reachable)) throw new Error("that is as far as it goes");
  followHeads(ev, ev.pitches, moved);
  setPitches(score, s, i, sortPitches(moved));
}

/** Event `i` given step `step` (C = 0 … B = 6) near where it was; a rest becomes that note. `add` adds it above a chord. */
export function letter(score, s, i, step, add = false, head = -1) {
  refuseDrums(score, s);
  const ev = noteOf(score, s, i);
  if (ev.rest) {
    const p = nearestPitch(step, previousPitch(score, s, i), keyOf(score, s, starts(score.staves[s])[i]));
    Object.assign(ev, { rest: false, pitches: [p] });
    return;
  }
  if (add) {
    const top = Math.max(...ev.pitches.map((p) => p.d));
    let d = top - mod7(top) + step;
    if (d <= top) d += 7;
    const p = { d, alter: keyAlters(keyOf(score, s, starts(score.staves[s])[i]))[mod7(d)] };
    if (!reachable(p)) throw new Error("that is as far as it goes");
    if (!ev.pitches.some((q) => q.d === p.d)) setPitches(score, s, i, sortPitches([...ev.pitches, p]));
    return;
  }
  const k = head >= 0 && head < ev.pitches.length ? head : 0;
  const p = nearestPitch(step, ev.pitches[k].d, keyOf(score, s, starts(score.staves[s])[i]));
  const now = ev.pitches.map((q, j) => (j === k ? p : q));
  followHeads(ev, ev.pitches, now);
  setPitches(score, s, i, sortPitches(now));
}

/** Event `i` given pitch `p` (a key played): a rest becomes that note, `add` adds it to the chord, else it replaces head `head` (the lowest). */
export function setPitch(score, s, i, p, add = false, head = -1) {
  refuseDrums(score, s);
  const ev = noteOf(score, s, i);
  if (!reachable(p)) throw new Error("that is as far as it goes");
  if (ev.rest) {
    Object.assign(ev, { rest: false, pitches: [{ ...p }] });
    return;
  }
  if (add) {
    if (!ev.pitches.some((q) => midiKey(q.d, q.alter) === midiKey(p.d, p.alter))) setPitches(score, s, i, sortPitches([...ev.pitches, p]));
    return;
  }
  const k = head >= 0 && head < ev.pitches.length ? head : 0;
  const now = ev.pitches.map((q, j) => (j === k ? p : q));
  followHeads(ev, ev.pitches, now);
  setPitches(score, s, i, sortPitches(now));
}

export function setAlter(score, s, i, alter, head = -1) {
  refuseDrums(score, s);
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("select a note");
  setPitches(score, s, i, ev.pitches.map((p, k) => (head < 0 || k === head ? { d: p.d, alter: Math.max(-2, Math.min(2, alter)) } : p)));
}

/** A note — or one head of a chord — taken away; a note becomes a rest of its length. */
export function remove(score, s, i, head = -1) {
  const ev = noteOf(score, s, i);
  if (ev.rest) return;
  if (head >= 0 && ev.pitches.length > 1) {
    // Its fingering goes with it.
    if (ev.fingers) ev.fingers = ev.fingers.filter((f) => f.head !== ev.pitches[head].d);
    if (ev.fingers?.length === 0) delete ev.fingers;
    ev.pitches = ev.pitches.filter((_, k) => k !== head);
    return;
  }
  Object.assign(ev, { rest: true, pitches: [], tie: false, slurStart: false, slurEnd: false, arts: [], lyric: null, graces: [], grace: null, arpeggio: false, gliss: false, tremolo: 0 });
  // A rest takes no fingering, and no phrasing slur starts or ends on it; no accidental, no tie let ring.
  delete ev.fingers;
  delete ev.phraseStart;
  delete ev.phraseEnd;
  delete ev.forced;
  delete ev.cautionary;
  delete ev.lv;
  delete ev.repeatTie;
  const prev = score.staves[s].events[i - 1];
  if (prev && prev.tie) prev.tie = false;
  tidy(score, score.staves[s]);
}

/** Event `i` written with another value: shorter leaves a rest, longer writes over what follows. */
export function setDuration(score, s, i, base, dots) {
  const staff = score.staves[s];
  const ev = noteOf(score, s, i);
  if (ev.tuplet) throw new Error("the notes of a tuplet keep their value: remove the tuplet first");
  const t = starts(staff)[i];
  const { id, base: _b, dots: _d, ...content } = ev;
  return write(score, s, t, notated(base, dots), content);
}

/** A tie from event `i` to the next note, or none. */
export function toggleTie(score, s, i) {
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("only a note is tied");
  const next = score.staves[s].events[i + 1];
  if (!ev.tie && (!next || next.rest)) throw new Error("a tie goes to the next note");
  // A tie joins the same pitches: the next note takes this one's.
  if (!ev.tie) next.pitches = ev.pitches.map((p) => ({ ...p }));
  ev.tie = !ev.tie;
}

/** A line from event `a` to event `b` over the fields `start` and `end` (a slur's, a phrasing slur's); see toggleSlur. */
function toggleLine(events, a, b, start, end, name) {
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  if (from === to) {
    const ev = events[from];
    if (ev[start] || ev[end]) {
      // On a note a slur starts or ends at: the slur goes, both its ends.
      const open = ev[start] ? from : events.slice(0, from).findLastIndex((e) => e[start]);
      const close = ev[end] ? from : events.findIndex((e, k) => k > from && e[end]);
      if (open >= 0) events[open][start] = false;
      if (close >= 0) events[close][end] = false;
      return;
    }
    // One note: slurred to the next one, as MuseScore does.
    const next = events.findIndex((e, k) => k > from && !e.rest);
    if (ev.rest || next < 0) throw new Error(`a ${name} goes from a note to a later note`);
    ev[start] = true;
    events[next][end] = true;
    return;
  }
  if (events[from].rest || events[to].rest) throw new Error(`a ${name} goes from a note to a note`);
  events[from][start] = !events[from][start];
  events[to][end] = events[from][start];
}

/** A slur from event `a` to event `b`; on one note, takes away the slurs it starts or ends. */
export function toggleSlur(score, s, a, b) {
  toggleLine(score.staves[s].events, a, b, "slurStart", "slurEnd", "slur");
}

/** A phrasing slur, `\(` … `\)`, from event `a` to event `b`: as toggleSlur, beside the slurs. */
export function togglePhrase(score, s, a, b) {
  const events = score.staves[s].events;
  toggleLine(events, a, b, "phraseStart", "phraseEnd", "phrasing slur");
  // Kept only where there is one: an event without carries no field.
  for (const ev of events) {
    if (!ev.phraseStart) delete ev.phraseStart;
    if (!ev.phraseEnd) delete ev.phraseEnd;
  }
}

// ---- Ottava lines -----------------------------------------------------------------
//
// `\ottava #n` stands before the event it starts on, as `ev.ottava` (n: 1
// 8va, 2 15ma, -1 8vb, -2 15mb, 0 the end of one). The notes keep the pitch
// they sound: an ottava changes where they are drawn, never what is played —
// LilyPond's own reading, and eui-score's MIDI.

export const OTTAVAS = [-2, -1, 0, 1, 2];

// What holds from the event it is written on until it changes, and its value
// before any: an ottava (`ev.ottava`), the stems (`ev.stemDir`: 1 \\stemUp,
// -1 \\stemDown, 0 \\stemNeutral), the beaming (`ev.noAutoBeam`: true
// \\autoBeamOff, false \\autoBeamOn). An event without one carries no field.
const MARKERS = { ottava: 0, stemDir: 0, noAutoBeam: false };

/** Marker `field` in force at event `i` of a lane. */
function markerAt(staff, i, field) {
  for (let k = Math.min(i, staff.events.length - 1); k >= 0; k--) if (staff.events[k][field] != null) return staff.events[k][field];
  return MARKERS[field];
}

/** A lane's marker `field`, kept only where it changes. */
function tidyMarkers(staff, field) {
  let now = MARKERS[field];
  for (const ev of staff.events) {
    if (ev[field] == null) continue;
    if (ev[field] === now) delete ev[field];
    else now = ev[field];
  }
}

/** The ottava in force at event `i` of a lane: 0 when none. */
export function ottavaAt(staff, i) {
  return markerAt(staff, i, "ottava");
}

function tidyOttavas(staff) {
  tidyMarkers(staff, "ottava");
}

/** Where an ottava may go: on the first voice of a staff of notes. */
function ottavaLane(score, s) {
  if (!score.staves[s]) throw new Error("no such staff");
  refuseDrums(score, s);
  if (isLower(score, s)) throw new Error("an ottava goes on the staff's first voice");
  return score.staves[s];
}

/**
 * Events `a` to `b` under an ottava of `value` (see OTTAVAS), what follows
 * them as it was; when they are all under it already, taken out of it.
 */
export function setOttava(score, s, a, b, value) {
  if (!OTTAVAS.includes(value)) throw new Error("an ottava is 8va, 15ma, 8vb or 15mb");
  const staff = ottavaLane(score, s);
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  if (!staff.events[from] || !staff.events[to]) throw new Error("no such note");
  const after = ottavaAt(staff, to);
  const under = staff.events.slice(from, to + 1).every((_, k) => ottavaAt(staff, from + k) === value);
  for (let k = from; k <= to; k++) delete staff.events[k].ottava;
  staff.events[from].ottava = under ? 0 : value;
  const next = staff.events[to + 1];
  if (next && next.ottava == null) next.ottava = after;
  tidyOttavas(staff);
}

/** The ottava in force at event `i` ended there: the notes from it on drawn where they sound. */
export function endOttava(score, s, i) {
  const staff = ottavaLane(score, s);
  if (!staff.events[i]) throw new Error("no such note");
  if (ottavaAt(staff, i) === 0) throw new Error("no ottava line here to end");
  staff.events[i].ottava = 0;
  tidyOttavas(staff);
}

// ---- Fingerings and string numbers ------------------------------------------------
//
// `ev.fingers`: `{ text, dir, head, circled }` each — `dir` -1 above (^), 1
// below (_), 0 where the engraver puts it (-); `head` the diatonic number of
// the chord's note it is written on, or null for the whole note; `circled` a
// string's number (`\3`), drawn in a circle.

/** Finger `text` (1–5) — or, `circled`, string `text` (1–6) — on note `i`, on head `head` of a chord; the same again takes it away. */
export function setFingering(score, s, i, text, { head = -1, circled = false } = {}) {
  const ev = pitchedNote(score, s, i);
  const figure = String(text);
  if (!(circled ? /^[1-6]$/ : /^[1-5]$/).test(figure)) throw new Error(circled ? "a string is 1 to 6" : "a finger is 1 to 5");
  const d = head >= 0 && ev.pitches.length > 1 ? ev.pitches[head]?.d ?? null : null;
  const fingers = ev.fingers ?? [];
  const same = (f) => Boolean(f.circled) === circled && (f.head ?? null) === d;
  const had = fingers.filter(same);
  const kept = fingers.filter((f) => !same(f));
  if (!(had.length === 1 && had[0].text === figure)) kept.push({ text: figure, dir: had[0]?.dir ?? 0, head: d, circled });
  if (kept.length) ev.fingers = kept;
  else delete ev.fingers;
}

/** Note `i`'s fingerings and string numbers taken away. */
export function removeFingerings(score, s, i) {
  delete noteOf(score, s, i).fingers;
}

/** A chord's fingerings follow its notes, moved from `was` to `now` head by head. */
function followHeads(ev, was, now) {
  // A reminder accidental stays on its note (cis! moved to d is d!).
  for (const field of ["forced", "cautionary"]) {
    if (!ev[field]) continue;
    ev[field] = ev[field].map((d) => {
      const k = was.findIndex((p) => p.d === d);
      return k >= 0 && now[k] ? now[k].d : d;
    });
  }
  if (!ev.fingers) return;
  ev.fingers = ev.fingers.map((f) => {
    const k = f.head == null ? -1 : was.findIndex((p) => p.d === f.head);
    return k >= 0 && now[k] ? { ...f, head: now[k].d } : f;
  });
}

export function setDynamic(score, s, i, dynamic) {
  const ev = noteOf(score, s, i);
  ev.dynamic = ev.dynamic === dynamic ? null : dynamic;
}

/** A hairpin opening at `a` and closing at `b` ("<" or ">"); on one event, toggles its start. */
export function setHairpin(score, s, a, b, kind) {
  const events = score.staves[s].events;
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  const ev = events[from];
  // A hairpin set by hand is drawn as a wedge.
  delete ev.hairpinWords;
  if (ev.hairpin === kind && from === to) {
    ev.hairpin = null;
    return;
  }
  ev.hairpin = kind;
  if (to > from) events[to].hairpinEnd = true;
}

export function toggleArticulation(score, s, i, name) {
  const ev = noteOf(score, s, i);
  if (ev.rest && name !== "fermata") throw new Error("select a note");
  ev.arts = ev.arts.includes(name) ? ev.arts.filter((a) => a !== name) : [...ev.arts, name];
}

/** A breath mark (`kind`: "breathe" or "caesura") after event `i`; the same again takes it away. */
export function toggleBreath(score, s, i, kind = "breathe") {
  if (!BREATHS.includes(kind)) throw new Error("a breath mark is breathe or caesura");
  const ev = noteOf(score, s, i);
  if (ev.breath === kind) delete ev.breath;
  else ev.breath = kind;
}

/**
 * Note `i`'s accidental printed whatever the key and the bar say — `kind`
 * "forced" (cis!) or "cautionary" (cis?, in parentheses) — on head `head`
 * of a chord, or every head; again takes it away.
 */
export function toggleReminder(score, s, i, kind, head = -1) {
  if (!["forced", "cautionary"].includes(kind)) throw new Error("an accidental is forced or cautionary");
  const ev = pitchedNote(score, s, i);
  const heads = (head >= 0 && ev.pitches[head] ? [ev.pitches[head]] : ev.pitches).map((p) => p.d);
  const other = kind === "forced" ? "cautionary" : "forced";
  const on = heads.every((d) => (ev[kind] ?? []).includes(d));
  ev[kind] = on ? (ev[kind] ?? []).filter((d) => !heads.includes(d)) : [...new Set([...(ev[kind] ?? []), ...heads])];
  ev[other] = (ev[other] ?? []).filter((d) => !heads.includes(d));
  for (const field of [kind, other]) if (!ev[field].length) delete ev[field];
}

// ---- Grace notes, arpeggios, glissandi, tremolos ---------------------------------

/** The note `i`, refused when it is a rest or on a drum staff. */
function pitchedNote(score, s, i) {
  refuseDrums(score, s);
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("select a note");
  return ev;
}

/** The pitch a step above `p` (`by` steps, down when negative), as the key at event `i` spells it. */
function stepFrom(score, s, i, p, by) {
  const q = movePitch(p, "step", by, keyOf(score, s, starts(score.staves[s])[i]));
  if (!reachable(q)) throw new Error("that is as far as it goes");
  return q;
}

/**
 * Grace notes of `kind` (see GRACES) before note `i`: a note without any
 * gets one, a step above its top note; a note with grace notes of that kind
 * loses them; of another kind, they change kind.
 */
export function setGrace(score, s, i, kind) {
  if (!GRACES.includes(kind)) throw new Error("no such grace note");
  const ev = pitchedNote(score, s, i);
  if (ev.tuplet) throw new Error("a note in a tuplet takes no grace note");
  if (ev.graces.length && ev.grace === kind) {
    Object.assign(ev, { graces: [], grace: null });
    return;
  }
  if (!ev.graces.length) {
    const top = ev.pitches[ev.pitches.length - 1];
    ev.graces = [{ pitches: [stepFrom(score, s, i, top, 1)], base: kind === "grace" ? 16 : 8, dots: 0 }];
  }
  ev.grace = kind;
}

/** One more grace note before note `i`, a step above the last one: two or more are sixteenths. */
export function addGrace(score, s, i) {
  const ev = pitchedNote(score, s, i);
  if (!ev.graces.length) return setGrace(score, s, i, "acciaccatura");
  if (ev.graces.length >= 8) throw new Error("eight grace notes at most");
  const last = ev.graces[ev.graces.length - 1];
  const p = stepFrom(score, s, i, last.pitches[last.pitches.length - 1], 1);
  ev.graces = [...ev.graces, { pitches: [p], base: 16, dots: 0 }].map((g) => ({ ...g, base: Math.max(g.base, 16) }));
}

/** The last grace note before note `i` moved by `by` steps (or semitones with `how` "semitone"). */
export function moveGrace(score, s, i, how, by) {
  const ev = pitchedNote(score, s, i);
  if (!ev.graces.length) throw new Error("this note has no grace note");
  const last = ev.graces[ev.graces.length - 1];
  const moved = last.pitches.map((p) => movePitch(p, how, by, keyOf(score, s, starts(score.staves[s])[i])));
  if (!moved.every(reachable)) throw new Error("that is as far as it goes");
  last.pitches = sortPitches(moved);
}

/** Note `i`'s grace notes taken away. */
export function removeGraces(score, s, i) {
  const ev = noteOf(score, s, i);
  if (!ev.graces.length) throw new Error("this note has no grace note");
  Object.assign(ev, { graces: [], grace: null });
}

/** A chord rolled — its notes played from the lowest up, a wavy line before it — or not. */
export function toggleArpeggio(score, s, i) {
  const ev = pitchedNote(score, s, i);
  if (ev.pitches.length < 2 && !ev.arpeggio) throw new Error("an arpeggio rolls a chord: add notes to it first");
  ev.arpeggio = !ev.arpeggio;
}

/** A glissando from note `i` to the next note, or none. */
export function toggleGlissando(score, s, i) {
  const ev = pitchedNote(score, s, i);
  const next = score.staves[s].events[i + 1];
  if (!ev.gliss && (!next || next.rest)) throw new Error("a glissando goes to the next note");
  ev.gliss = !ev.gliss;
}

/** Note `i` repeated in strokes of `value` (8, 16, 32) — or not, given its own value again. */
export function setTremolo(score, s, i, value) {
  if (!TREMOLOS.includes(value)) throw new Error("a tremolo is in eighths, sixteenths or thirty-seconds");
  const ev = pitchedNote(score, s, i);
  if (ev.tremolo === value) {
    ev.tremolo = 0;
    return;
  }
  if (value <= ev.base) throw new Error(`a tremolo's strokes are shorter than the note: 1/${value} on a 1/${ev.base} is not one`);
  ev.tremolo = value;
}

export function setChordSymbol(score, s, i, text) {
  noteOf(score, s, i).chord = text.trim();
}

/** The most verses a score's lyrics may have: a line under the staff each. */
export const MAX_VERSES = 6;

/** Event `i`'s syllable of verse `verse` (1 the first); empty text takes it away. */
export function setLyric(score, s, i, text, hyphen = false, extend = false, verse = 1) {
  if (isLower(score, s)) throw new Error("words go with the first voice");
  if (!Number.isInteger(verse) || verse < 1 || verse > MAX_VERSES) throw new Error(`a verse is 1 to ${MAX_VERSES}`);
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("a syllable goes under a note");
  putSyllable(ev, verse, text.trim() ? { text: text.trim(), hyphen, extend } : null);
}

function putSyllable(ev, verse, syllable) {
  if (verse === 1) {
    ev.lyric = syllable;
    return;
  }
  ev.verses = [...(ev.verses ?? [])];
  while (ev.verses.length < verse - 1) ev.verses.push(null);
  ev.verses[verse - 2] = syllable;
  while (ev.verses.length && !ev.verses[ev.verses.length - 1]) ev.verses.pop();
}

/** Event `ev`'s syllable of verse `verse` (1 the first), or null. */
export function syllableOf(ev, verse = 1) {
  return (verse === 1 ? ev.lyric : ev.verses?.[verse - 2]) ?? null;
}

/** How many verses staff `staff` sings: its last verse with a syllable in it. */
export function versesOf(staff) {
  let n = 0;
  for (const ev of staff.events) {
    if (ev.lyric) n = Math.max(n, 1);
    (ev.verses ?? []).forEach((syl, k) => {
      if (syl) n = Math.max(n, k + 2);
    });
  }
  return n;
}

/**
 * Event `i` turned into a tuplet of `n` notes in its time — 3 a triplet, 5,
 * 6, 7 — each `d`× shorter than its value (2 for a triplet, 4 for 5–7). The
 * first keeps the note, the others are rests to write into.
 */
export function makeTuplet(score, s, i, n) {
  const staff = score.staves[s];
  const ev = noteOf(score, s, i);
  if (ev.tuplet) throw new Error("already in a tuplet");
  if (ev.dots) throw new Error("a dotted value cannot be split into a tuplet");
  if (ev.graces.length) throw new Error("a tuplet's notes take no grace notes: take them away first");
  const d = n === 3 ? 2 : 4;
  const base = ev.base * d;
  if (base > 32) throw new Error("too short to split");
  const tuplet = { id: newId(), n, d };
  const group = Array.from({ length: n }, (_, k) =>
    k === 0 ? cloneEvent(ev, { base, dots: 0, tuplet, tie: false, tremolo: ev.tremolo > base ? ev.tremolo : 0 }) : makeEvent({ base, dots: 0, tuplet }),
  );
  staff.events.splice(i, 1, ...group);
}

/**
 * A tuplet of `n` written at `t`, in the time of `value` ticks (a written
 * value: the input's duration) — what Ctrl+3 does while notes are being
 * written. Answers the index of its first note.
 */
export function tupletAt(score, s, t, value, n) {
  const i = write(score, s, t, value, { rest: true }, { tidyUp: false });
  makeTuplet(score, s, i, n);
  tidy(score, score.staves[s]);
  return eventAt(score.staves[s], t);
}

/** The tuplet event `i` is in, made one plain value again: its first note, or a rest. */
export function removeTuplet(score, s, i) {
  const staff = score.staves[s];
  const [a, b] = tupletBounds(staff, i);
  if (!staff.events[i].tuplet) throw new Error("not in a tuplet");
  const t = starts(staff)[a];
  const ticks = staff.events.slice(a, b + 1).reduce((sum, ev) => sum + ticksOf(ev), 0);
  const first = staff.events[a];
  const values = spellDuration(ticks);
  staff.events.splice(a, b - a + 1, ...values.map((v, k) => cloneEvent(first, { base: v.base, dots: v.dots, tuplet: null, tie: !first.rest && k < values.length - 1 })));
  return eventAt(staff, t);
}

/**
 * What the editor says when the engraver cannot draw an edit: in plain words,
 * with the engraver's reason once its internals (the "score:" prefix, the
 * character it stopped at) are taken out.
 */
export function plainRefusal(message) {
  const reason = String(message ?? "")
    .replace(/^\s*score:\s*/i, "")
    .replace(/\s*\(at character \d+\)\s*$/i, "")
    .trim();
  const said = "That change would make a score the page cannot draw, so it was not made";
  return reason ? `${said}: ${reason}.` : `${said}.`;
}

// ---- Ranges ---------------------------------------------------------------------

/** Events `a`…`b` of staff `s`, for a clipboard: content and duration, and the ticks they span. */
export function copy(score, s, a, b) {
  const staff = score.staves[s];
  const events = staff.events.slice(Math.min(a, b), Math.max(a, b) + 1);
  if (events.some((ev) => ev.tuplet)) throw new Error("Triplets and other tuplets cannot be copied yet: leave them out of the selection.");
  return events.map((ev) => ({ content: { ...structuredClone(ev), id: undefined }, ticks: ticksOf(ev) }));
}

/** A clipboard as LilyPond, for another program or another page: its notes in absolute pitches. */
export function clipText(clip) {
  return clip.map((piece) => eventText(makeEvent(piece.content))).join(" ");
}

/**
 * A clipboard from LilyPond text another program copied, read by eui-score's
 * parser (`parse`, which is `score_json`): the notes of its first staff, as
 * long as the text says — not the rests that fill its last bar. Throws when
 * the text is not music.
 */
export function clipFromText(text, parse) {
  const source = text.includes("{") ? text : `{ ${text} }`;
  const parsed = JSON.parse(parse(source));
  const lane = parsed.staves[0];
  if (!lane) throw new Error("the clipboard holds no notes");
  if (lane.events.some((ev) => ev.tuplet)) throw new Error("The clipboard holds tuplets (triplets and the like), which cannot be pasted yet.");
  const length = lane.events.reduce((sum, ev) => sum + (ev.ticks ?? 0), 0);
  const { score } = fromParsed(parsed);
  if (!score || !length) throw new Error("the clipboard holds no notes");
  const staff = score.staves[0];
  const at = starts(staff);
  return staff.events
    .filter((_, k) => at[k] < length)
    .map((ev) => ({ content: { ...structuredClone(ev), id: undefined }, ticks: ticksOf(ev) }));
}

/** A clipboard written from `t` (ticks) on: answers the index of the last event written. */
export function paste(score, s, t, clip) {
  let last = -1;
  for (const piece of clip) {
    const { base, dots, tuplet, ...content } = piece.content;
    last = write(score, s, t, piece.ticks, content);
    t += piece.ticks;
  }
  return last;
}

// ---- Recording ------------------------------------------------------------------
//
// Keys played live, as { key, t0, t1 } in ticks, written into a lane: their
// starts and ends moved to the nearest step of the grid, keys sounding
// together as a chord, a note held on over the next one's start tied to it.

/**
 * The grids a recording is fitted to, in ticks: the finest step it keeps. A
 * triplet grid writes as triplets the beats where a note starts or stops
 * off the beat, the others as they are.
 */
export const RECORDING_GRIDS = {
  quarter: WHOLE / 4,
  eighth: WHOLE / 8,
  "eighth-triplet": WHOLE / 12,
  sixteenth: WHOLE / 16,
  "sixteenth-triplet": WHOLE / 24,
  "thirty-second": WHOLE / 32,
};

/** A triplet grid's beat (three of its steps), or 0 for a plain grid. */
function tripletBeat(grid) {
  return Math.round(WHOLE / grid) % 3 === 0 ? 3 * grid : 0;
}

/** How far past its end the music goes on while recording or looping: the bars played after the last one. */
export const RECORDING_MORE_BARS = 32;

/**
 * The score as it plays while recorded into or looped: RECORDING_MORE_BARS
 * more bars, so the music (and its metronome) goes on past the last note, an
 * empty score's too. A staff of its own, last, holds one short note at their
 * very end, which makes them last: its channel (the last of `channels`) is
 * the player's to mute.
 */
export function padded(score) {
  const out = structuredClone(score);
  const end = barsOf(out);
  insertBars(out, end, RECORDING_MORE_BARS);
  const total = barStart(out, end + RECORDING_MORE_BARS);
  out.staves.push({ name: "", short: "", instrument: "", clef: "treble", padding: true, events: rests(out, 0, total) });
  write(out, out.staves.length - 1, total - WHOLE / 16, WHOLE / 16, { rest: false, pitches: [{ d: 28, alter: 0 }] });
  return out;
}

/** The notes moved to `grid` (ticks): a note shorter than a step lasts a step. */
export function quantize(notes, grid) {
  return notes.map((n) => {
    const t0 = Math.round(n.t0 / grid) * grid;
    const t1 = Math.max(t0 + grid, Math.round(n.t1 / grid) * grid);
    return { ...n, t0, t1 };
  });
}

/** The dynamic a key struck at `velocity` (1–127) reads as. */
export function dynamicOfVelocity(velocity) {
  if (velocity < 32) return "pp";
  if (velocity < 48) return "p";
  if (velocity < 64) return "mp";
  if (velocity < 80) return "mf";
  if (velocity < 100) return "f";
  return "ff";
}

/**
 * The keys played (`{ key, t0, t1, velocity? }`) written over lane `s` from
 * `from` to `to` (ticks, bar lines): what was there replaced, the rest of it
 * left as it was. Keys sounding together are a chord, a key held on into the
 * next is tied to it; on a drum staff each key is its General MIDI drum, and
 * keys no drum answers to are left out. With `dynamics`, the dynamic of how
 * hard the keys were struck is marked where it changes and holds for two
 * notes at least. Answers how many notes were written.
 */
export function writeRecording(score, s, from, to, played, grid, { dynamics = false } = {}) {
  if (to <= from) return 0;
  const drums = isDrums(score, s);
  const notes = quantize(played, grid)
    .filter((n) => n.t1 > from && n.t0 < to && (!drums || drumByKey(n.key)))
    .map((n) => ({ ...n, t0: Math.max(from, n.t0), t1: Math.min(to, n.t1) }));
  write(score, s, from, to - from, { rest: true });
  // The beats written as triplets: those where something starts or stops off the beat.
  const beat = tripletBeat(grid);
  const triplets = new Set();
  if (beat) {
    for (const t of notes.flatMap((n) => [n.t0, n.t1])) if (t > from && t < to && (t - from) % beat) triplets.add(t - ((t - from) % beat));
  }
  const inTriplet = (t) => [...triplets].some((u) => t >= u && t < u + beat);
  const sounding = (a, b) => [...new Set(notes.filter((n) => n.t0 <= a && n.t1 >= b).map((n) => n.key))].sort((x, y) => x - y);
  const pitches = (keys, at) => sortPitches(keys.map((key) => (drums ? drumPitch(drumByKey(key)) : pitchOfKey(key, keyOf(score, s, at)))));
  // Where anything starts or stops, and the triplets' edges: between two of them, one chord.
  const edges = [...new Set([from, to, ...notes.flatMap((n) => [n.t0, n.t1]), ...[...triplets].flatMap((u) => [u, u + beat])])].sort((x, y) => x - y);
  const spans = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const [a, b] = [edges[k], edges[k + 1]];
    if (inTriplet(a)) continue;
    const keys = sounding(a, b);
    // Struck again here: a key starting at `a` is a new note, not the held one.
    const struck = notes.some((n) => n.t0 === a);
    const last = spans[spans.length - 1];
    if (last && last.b === a && !struck && last.keys.join() === keys.join()) last.b = b;
    else spans.push({ a, b, keys });
  }
  for (const span of spans) {
    if (span.keys.length) write(score, s, span.a, span.b - span.a, { rest: false, pitches: pitches(span.keys, span.a) });
  }
  for (const u of [...triplets].sort((x, y) => x - y)) {
    const i = tupletAt(score, s, u, beat, 3);
    for (let k = 0; k < 3; k++) {
      const keys = sounding(u + k * grid, u + (k + 1) * grid);
      if (keys.length) Object.assign(score.staves[s].events[i + k], { rest: false, pitches: pitches(keys, u) });
    }
  }
  const staff = score.staves[s];
  const at = starts(staff);
  const keysOf = (ev) => ev.pitches.map((p) => (p.drum ? drumKey(p.drum) : midiKey(p.d, p.alter)));
  // The ties last, as writing cuts any tie into what it writes: a key held
  // on from one note into the next, not struck again there, ties them.
  if (!drums) {
    for (let i = 0; i + 1 < staff.events.length; i++) {
      const [ev, next, t] = [staff.events[i], staff.events[i + 1], at[i + 1]];
      if (t <= from || t >= to || ev.rest || next.rest) continue;
      if (notes.some((n) => n.t0 < t && n.t1 > t && keysOf(ev).includes(n.key) && keysOf(next).includes(n.key))) ev.tie = true;
    }
  }
  if (dynamics) markDynamics(staff, at, notes);
  return notes.length;
}

/** The dynamics of how hard the keys were struck, where the level changes and holds for two notes (or starts). */
function markDynamics(staff, at, notes) {
  const times = [...new Set(notes.map((n) => n.t0))].sort((x, y) => x - y);
  const levels = times.map((t) => {
    const struck = notes.filter((n) => n.t0 === t);
    return dynamicOfVelocity(struck.reduce((sum, n) => sum + (n.velocity ?? 80), 0) / struck.length);
  });
  let current = null;
  levels.forEach((level, k) => {
    if (level === current) return;
    if (current !== null && levels[k + 1] !== level) return;
    const i = at.indexOf(times[k]);
    if (i < 0 || staff.events[i].rest) return;
    staff.events[i].dynamic = level;
    current = level;
  });
}

// ---- Notes moved on the piano roll --------------------------------------------

/**
 * Lane `s`'s note `i` (and the notes tied to it) moved `shift` ticks in time,
 * its head on MIDI key `key` (every head with null) moved `semitones`, and
 * lasting `length` ticks (null: as long as it did). What was under its new
 * place is written over, where it was is left as rests, ties across bar
 * lines follow. Answers the index of its first event.
 */
export function moveNote(score, s, i, { key = null, semitones = 0, shift = 0, length = null } = {}) {
  const staff = score.staves[s];
  const ev = staff?.events[i];
  if (!ev || ev.rest) throw new Error("no note there");
  const [a, b] = tiedNotes(staff, i);
  if (staff.events.slice(a, b + 1).some((x) => x.tuplet)) throw new Error("a tuplet's notes cannot be moved yet");
  const at = starts(staff);
  const t0 = at[a];
  const was = at[b] + ticksOf(staff.events[b]) - t0;
  const t = t0 + shift;
  const ticks = length ?? was;
  if (t < 0 || ticks <= 0) throw new Error("that is as far as it goes");
  const drums = isDrums(score, s);
  const fifths = keyOf(score, s, t);
  const keyOfPitch = (p) => (p.drum ? drumKey(p.drum) : midiKey(p.d, p.alter));
  const moved = ev.pitches.map((p) => {
    const k = keyOfPitch(p);
    if (!semitones || (key != null && k !== key)) return { ...p };
    if (k + semitones < 21 || k + semitones > 108) throw new Error("that is as far as it goes");
    if (!drums) return pitchOfKey(k + semitones, fifths);
    const name = drumByKey(k + semitones);
    if (!name) throw new Error("no drum on that key");
    return drumPitch(name);
  });
  // Two heads on one key are one.
  const pitches = sortPitches(moved.filter((p, n) => moved.findIndex((q) => keyOfPitch(q) === keyOfPitch(p)) === n));
  const { base, dots, tuplet, id, ...content } = structuredClone(ev);
  write(score, s, t0, was, { rest: true });
  write(score, s, t, ticks, { ...content, rest: false, pitches, tie: false });
  return eventAt(staff, t);
}

// A section is bars a…b of several lanes at once: what the MIDI view copies.
// Each part keeps its staff's place among the staves copied, counted from the
// first (`offset`), and its voice: pasted, it goes to that voice of the staff
// as far below — made when the staff has no such voice yet. A section of one
// lane goes to the lane it is pasted on, whichever voice that is.

/** Bars `a`…`b` of `lanes`, for a clipboard: `{ bars, parts: [{ offset, voice, pieces }] }`. */
export function copySection(score, lanes, a, b) {
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  if (!lanes.length) throw new Error("choose a staff to copy");
  const t0 = barStart(score, from);
  const t1 = barStart(score, to + 1);
  const first = Math.min(...lanes.map((s) => staffNumber(score, s)));
  const parts = [...lanes].sort((x, y) => x - y).map((s) => {
    const staff = score.staves[s];
    const at = starts(staff);
    const inside = staff.events.map((_, i) => i).filter((i) => at[i] >= t0 && at[i] < t1);
    return { offset: staffNumber(score, s) - first, voice: voiceOf(score, s), pieces: inside.length ? copy(score, s, inside[0], inside[inside.length - 1]) : [] };
  });
  return { bars: to - from + 1, parts };
}

/** The lane part `part` of `section` goes to when pasted on lane `lane`: −1 when the score has no staff there, null when its voice is still to be made. */
function partLane(score, lane, section, part) {
  if (section.parts.length === 1) return lane;
  const staff = staffLanes(score)[staffNumber(score, lane) + part.offset];
  if (staff == null) return -1;
  const own = laneOfVoice(score, staff, part.voice ?? 1);
  return own >= 0 ? own : null;
}

/** The lanes a section pasted on lane `lane` went to, those it found. */
export function sectionLanes(score, lane, section) {
  return section.parts.map((part) => partLane(score, lane, section, part)).filter((s) => s != null && s >= 0);
}

/**
 * A section written over the bars from `bar` on, each part on its staff and
 * voice (see above): answers how many parts found no staff there.
 */
export function pasteSection(score, lane, bar, section) {
  const t = barStart(score, bar);
  let skipped = 0;
  for (const part of section.parts) {
    // Lanes after the staff move as voices are made: each part's place is found again
    // (the staff pasted on itself only grows after its own voices, `lane` stays).
    let s = partLane(score, lane, section, part);
    if (s === -1) {
      skipped++;
      continue;
    }
    if (s === null) {
      // A voice of rests the staff lacks is not made for nothing.
      if (part.pieces.every((p) => p.content.rest)) continue;
      s = addVoice(score, staffLanes(score)[staffNumber(score, lane) + part.offset], part.voice);
    }
    paste(score, s, t, part.pieces);
  }
  return skipped;
}

/** A section put in before bar `bar`, as new bars: answers how many parts found no lane. */
export function insertSection(score, lane, bar, section) {
  insertBars(score, bar, section.bars);
  return pasteSection(score, lane, bar, section);
}

/** A section as LilyPond, for another program: a staff per part. */
export function sectionText(section) {
  const staves = section.parts.map((part) => `\\new Staff { ${clipText(part.pieces)} }`);
  return staves.length === 1 ? staves[0] : `<< ${staves.join(" ")} >>`;
}

// ---- The score's settings --------------------------------------------------------------

/** The score's key; a staff written in a key of its own (a horn in E♭) moves with it. */
export function setKey(score, fifths) {
  const clamp = (k) => Math.max(-7, Math.min(7, k));
  const to = clamp(fifths);
  for (const s of staffLanes(score)) {
    const staff = score.staves[s];
    if (staff.key == null) continue;
    staff.key = clamp(staff.key + to - score.key);
    if (staff.key === to) delete staff.key;
  }
  score.key = to;
}

/** Staff `s` in a key of its own; the score's key takes it back to the score's. */
export function setStaffKey(score, s, fifths) {
  const staff = score.staves[upperOf(score, s)];
  if (!staff) throw new Error("no such staff");
  const to = Math.max(-7, Math.min(7, fifths));
  if (to === score.key) delete staff.key;
  else staff.key = to;
}

// ---- Staves, voices, groups -----------------------------------------------------------
//
// `score.staves` holds lanes of events. A staff is one lane — its first voice,
// with the staff's settings — and, when it has more voices, the lanes right
// after it, in order: { voice: 2, events }, { voice: 3, … }, { voice: 4, … }.
// Voices 1 and 3 have their stems up, 2 and 4 down, as LilyPond sets them;
// a staff with voice 3 has voice 2 too (rests, where it is silent). Every
// edit on events works on a lane; what belongs to the staff — its clef and
// clef changes, its key, its name, its lyrics and its ottavas (the engraver
// reads an \ottava from the first voice only) — lives on its first lane.
// `score.group` brackets every staff; `score.groups` are the groups inside
// it, { kind, first, last } in staves (not lanes), possibly nested.

/** The most voices a staff holds. */
export const MAX_VOICES = 4;
const VOICE_NAMES = ["One", "Two", "Three", "Four"];

/** Whether lane `s` is a staff's second, third or fourth voice. */
export function isLower(score, s) {
  return (score.staves[s]?.voice ?? 1) >= 2;
}

/** The voice lane `s` is, 1 to 4. */
export function voiceOf(score, s) {
  return score.staves[s]?.voice ?? 1;
}

/** The staff's first lane, for any of its lanes. */
export function upperOf(score, s) {
  let u = s;
  while (u > 0 && isLower(score, u)) u--;
  return u;
}

/** The lanes of the staff of lane `s`, voice 1 first. */
export function voiceLanes(score, s) {
  const u = upperOf(score, s);
  const lanes = [u];
  while (isLower(score, lanes.length + u)) lanes.push(lanes.length + u);
  return lanes;
}

/** The lane of voice `voice` on the staff of lane `s`, or −1. */
export function laneOfVoice(score, s, voice) {
  return voiceLanes(score, s)[voice - 1] ?? -1;
}

/** The staff's second voice's lane, or −1. */
export function lowerOf(score, s) {
  return laneOfVoice(score, s, 2);
}

/** Each staff's first lane, in order. */
export function staffLanes(score) {
  return score.staves.map((_, s) => s).filter((s) => !isLower(score, s));
}

/** Which staff lane `s` is on, counted from 0. */
export function staffNumber(score, s) {
  return staffLanes(score).indexOf(upperOf(score, s));
}

/** The key lane `s` is written in at time `t`: the score's then, moved as far as the staff's own. */
export function keyOf(score, s, t = 0) {
  const staff = score.staves[upperOf(score, s)];
  const own = staff?.key == null ? 0 : staff.key - score.key;
  const b = barAt(score, t);
  return Math.max(-7, Math.min(7, scoreKeyAt(score, b, t - barStart(score, b)) + own));
}

/**
 * Voice `voice` (2 to 4) on the staff of lane `s`, rests to begin with, and
 * the voices before it when it has none yet: answers its lane.
 */
export function addVoice(score, s, voice = 2) {
  const u = upperOf(score, s);
  if (!score.staves[u]) throw new Error("no such staff");
  if (!Number.isInteger(voice) || voice < 2 || voice > MAX_VOICES) throw new Error(`a staff holds ${MAX_VOICES} voices at most`);
  for (let v = voiceLanes(score, u).length + 1; v <= voice; v++) {
    score.staves.splice(u + v - 1, 0, { voice: v, events: rests(score, 0, lengthOf(score.staves[u])) });
  }
  return laneOfVoice(score, u, voice);
}

/**
 * A voice of the staff of lane `s` taken away, its notes with it: `voice`,
 * or the lane's own when it is one, or else the staff's last. A voice after
 * it keeps its number (and its stems), the one taken away left as rests;
 * voices of rests at the end go.
 */
export function removeVoice(score, s, voice = null) {
  const lanes = voiceLanes(score, s);
  if (lanes.length < 2) throw new Error("this staff has one voice");
  const v = voice ?? (isLower(score, s) ? voiceOf(score, s) : lanes.length);
  if (v < 2 || v > lanes.length) throw new Error(`this staff has no voice ${v}`);
  const lane = lanes[v - 1];
  score.staves[lane].events = rests(score, 0, lengthOf(score.staves[lanes[0]]));
  for (let k = lanes.length - 1; k >= 1 && !sounding(score.staves[lanes[k]].events); k--) score.staves.splice(lanes[k], 1);
}

/** A bar of another voice is written when something in it is: a note, or a rest with a mark. */
function sounding(events) {
  return events.some((ev) => !ev.rest || ev.dynamic || ev.hairpin || ev.hairpinEnd || ev.texts.length || ev.chord || ev.arts.length || ev.pedalOn || ev.pedalOff);
}

/** A new time signature for the whole piece's first metre. */
export function setTime(score, num, den) {
  setTimeAt(score, 0, num, den);
}

/**
 * Metre `num`/`den` from bar `b` on, up to the next change of metre: the
 * music there is laid out again in bars of the new metre, ties across the
 * new bar lines. What else is counted in bars (repeats, the other changes,
 * clefs) keeps its place in time, and must fall on a bar line still.
 */
export function setTimeAt(score, b, num, den) {
  // Worked on a copy: a refusal halfway leaves the score as it was.
  const work = structuredClone(score);
  retime(work, b, num, den);
  Object.assign(score, work);
}

function retime(score, b, num, den) {
  const bars = barsOf(score);
  if (b < 0 || b >= bars) throw new Error("no such bar");
  if (![1, 2, 4, 8, 16].includes(den) || !Number.isInteger(num) || num < 1 || num > 32) throw new Error("no such metre");
  const len = (WHOLE * num) / den;
  const old = { time: score.time, changes: structuredClone(score.changes ?? []), pickup: score.pickup };
  // A pickup stays as long as it is, before the full bars of the first metre.
  const pickup = score.pickup > 0 ? score.pickup : 0;
  if (b === 0 && pickup >= len) throw new Error(`the pickup is not shorter than a bar of ${num}/${den}: change it first`);
  const from = barStart(old, b);
  const next = old.changes.find((c) => c.bar > b && c.time);
  const total = lengthOf(score.staves[0]);
  const to = next ? barStart(old, next.bar) : total;
  // What is laid out in full bars: after the pickup, when the first metre changes.
  const inBars = to - from - (b === 0 ? pickup : 0);
  if (next && inBars % len !== 0) throw new Error(`the bars up to the next change of metre would not make whole bars of ${num}/${den}`);
  const grown = (next ? inBars : Math.ceil(inBars / len) * len) - inBars;
  for (const staff of score.staves) {
    const at = starts(staff);
    if (staff.events.some((ev, k) => ev.tuplet && at[k] >= from && at[k] < to)) throw new Error("move or remove the tuplets in those bars before changing the metre");
  }
  // Everything counted in bars, as times.
  const tick = (bar) => barStart(old, bar);
  const marks = old.changes.filter((c) => c.bar !== b).map((c) => ({ ...c, at: tick(c.bar) }));
  marks.push({ ...(old.changes.find((c) => c.bar === b) ?? {}), bar: b, at: from, time: [num, den] });
  marks.sort((x, y) => x.at - y.at);
  const repeats = (score.repeats ?? []).map((r) => ({ from: tick(r.from), to: tick(r.to + 1), ends: r.endings.map((_, k) => tick(r.to + 1 + r.endings.slice(0, k + 1).reduce((x, y) => x + y, 0))), times: r.times }));
  const clefs = score.staves.map((staff) => (staff.clefs ?? []).map((c) => ({ ...c, at: tick(c.bar) })));
  // The changes inside bars keep their time: they may fall anywhere.
  const midClefs = score.staves.map((staff) => (staff.midClefs ?? []).map((c) => ({ ...c, at: tick(c.bar) + c.pos })));
  const midKeys = (score.midKeys ?? []).map((m) => ({ ...m, at: tick(m.bar) + m.pos }));
  // The new bars: each mark's bar counted in the new metres.
  // The bars laid out again stay where they were; what is after them moves by what they grew.
  const shift = (t) => (t > from && t >= to ? t + grown : t);
  // After a pickup, the full bars are counted from bar 1, where it ends.
  let seg = { bar: pickup ? 1 : 0, at: pickup, len: b === 0 ? len : (WHOLE * score.time[0]) / score.time[1] };
  const changes = [];
  for (const m of marks) {
    const at = shift(m.at);
    const rel = (at - seg.at) / seg.len;
    if (at > 0 && !Number.isInteger(rel)) throw new Error("the changes of key, tempo or clef there would fall inside bars: move them first");
    const bar = at === 0 ? 0 : seg.bar + rel;
    const { at: _, ...change } = m;
    change.bar = bar;
    if (bar === 0) {
      score.time = change.time ?? score.time;
    } else {
      // A metre that is the one in force already is no change.
      if (change.time && change.time[0] === (seg.time ?? score.time)[0] && change.time[1] === (seg.time ?? score.time)[1]) delete change.time;
      if (Object.keys(change).length > 1) changes.push(change);
    }
    if (m.time) seg = bar === 0 && pickup ? { bar: 1, at: pickup, len: (WHOLE * m.time[0]) / m.time[1], time: m.time } : { bar, at, len: (WHOLE * m.time[0]) / m.time[1], time: m.time };
  }
  if (b === 0) {
    score.time = [num, den];
    for (const s2 of staffLanes(score)) delete score.staves[s2].time;
  }
  score.changes = changes;
  const barOf = (t) => {
    const at = shift(t);
    if (!isBarLine(score, at)) throw new Error("the repeats would fall inside bars: remove them before changing the metre");
    return barAt(score, at);
  };
  const moved = repeats.map((r) => {
    const f = barOf(r.from);
    const t = barOf(r.to) - 1;
    let last = t + 1;
    const endings = r.ends.map((e) => {
      const end = barOf(e);
      const n = end - last;
      last = end;
      return n;
    });
    return { from: f, to: t, endings, ...(r.times ? { times: r.times } : {}) };
  });
  clefs.forEach((list, k) => {
    if (!list.length) return;
    score.staves[k].clefs = list.map((c) => {
      const at = shift(c.at);
      if (!isBarLine(score, at)) throw new Error("the changes of key, tempo or clef there would fall inside bars: move them first");
      return { bar: barAt(score, at), clef: c.clef };
    });
  });
  const placed = (m) => {
    const at = shift(m.at);
    const bar = barAt(score, at);
    const { at: _, ...rest } = m;
    return { ...rest, bar, pos: at - barStart(score, bar) };
  };
  midClefs.forEach((list, k) => {
    if (list.length) score.staves[k].midClefs = list.map(placed);
  });
  if (midKeys.length) score.midKeys = midKeys.map(placed);
  // The music of those bars, laid out again.
  for (const [k, staff] of score.staves.entries()) {
    const at = starts(staff);
    const before = staff.events.filter((_, i) => at[i] < from);
    const inside = staff.events.map((ev, i) => ({ ev, t: at[i] })).filter(({ t }) => t >= from && t < to);
    const after = staff.events.filter((_, i) => at[i] >= to);
    staff.events = [...before, ...rests(score, from, to - from + grown), ...after];
    for (const { ev, t } of inside) {
      if (ev.rest && !ev.dynamic && !ev.texts.length && !ev.chord && !ev.hairpin && !ev.hairpinEnd && !ev.pedalOn && !ev.pedalOff) continue;
      const { id, base, dots, ...content } = ev;
      write(score, k, t, ticksOf(ev), content);
    }
  }
  ensureLength(score, Math.max(...score.staves.map(lengthOf)));
  score.repeats = moved;
}

/** The key from bar `b` on (bar 0: the score's key); the key in force already takes the change away. */
export function setKeyAt(score, b, fifths) {
  if (b <= 0) return setKey(score, fifths);
  const to = fifths == null ? null : Math.max(-7, Math.min(7, fifths));
  setChange(score, b, "key", to === scoreKeyAt(score, b - 1, Infinity) ? null : to);
  // A change of key set here is a major key's; none, no mode.
  setChange(score, b, "mode", null);
}

/** A double bar line before bar `b`, or none. */
export function setDoubleBar(score, b, on) {
  if (b <= 0 || b >= barsOf(score)) throw new Error("a double bar goes between two bars");
  setChange(score, b, "line", on ? "||" : null);
}

/** The tempo from bar `b` on — { text, base, bpm }, bpm 0 for words alone; null takes it away. */
export function setTempoAt(score, b, tempo) {
  const kept = tempo && (tempo.text || tempo.bpm) ? { text: tempo.text ?? "", base: tempo.base || 4, bpm: tempo.bpm || 0 } : null;
  if (b <= 0) score.tempo = kept;
  else setChange(score, b, "tempo", kept);
}

/** Lane `s`'s staff in clef `clef` from bar `b` on; the clef in force already takes the change away. */
export function setClefAt(score, s, b, clef) {
  const staff = score.staves[upperOf(score, s)];
  if (!staff) throw new Error("no such staff");
  if (clef != null && !CLEFS.includes(clef)) throw new Error("no such clef");
  if (b <= 0) {
    if (clef) staff.clef = clef;
    return;
  }
  const kept = (staff.clefs ?? []).filter((c) => c.bar !== b);
  staff.clefs = kept;
  if (clef && clef !== clefAt(score, s, b - 1, Infinity)) staff.clefs = [...kept, { bar: b, clef }].sort((x, y) => x.bar - y.bar);
  if (!staff.clefs.length) delete staff.clefs;
}

export function addStaff(score, fields = {}) {
  score.staves.push(emptyStaff(score, fields));
  if (staffLanes(score).length > 1 && score.group === "none" && !(score.groups ?? []).length) score.group = "bracket";
}

/** The staff of lane `s` taken away, all its voices; the groups around it close up. */
export function removeStaff(score, s) {
  if (staffLanes(score).length < 2) throw new Error("a score keeps one staff at least");
  const u = upperOf(score, s);
  const n = staffNumber(score, u);
  score.staves.splice(u, voiceLanes(score, u).length);
  score.groups = (score.groups ?? [])
    .map((g) => ({ ...g, first: g.first > n ? g.first - 1 : g.first, last: g.last >= n ? g.last - 1 : g.last }))
    .filter((g) => g.last >= g.first);
}

/** Bars of rests added at the end of every staff. */
export function addBars(score, count = 1) {
  ensureLength(score, barStart(score, barsOf(score) + count));
}

/** The last bar taken away when it holds nothing but rests. */
export function removeLastBar(score) {
  const bars = barsOf(score);
  if (bars < 2) throw new Error("a score keeps one bar at least");
  const from = barStart(score, bars - 1);
  for (const staff of score.staves) {
    const at = starts(staff);
    if (staff.events.some((ev, k) => at[k] >= from && !ev.rest)) throw new Error("the last bar is not empty");
  }
  if (repeatAt(score, bars - 1)) throw new Error("the last bar is in a repeat: remove the repeat first");
  for (const staff of score.staves) {
    const at = starts(staff);
    staff.events = staff.events.filter((_, k) => at[k] < from);
    if (staff.clefs) staff.clefs = staff.clefs.filter((c) => c.bar < bars - 1);
    if (staff.midClefs) staff.midClefs = staff.midClefs.filter((c) => c.bar < bars - 1);
  }
  score.changes = (score.changes ?? []).filter((c) => c.bar < bars - 1);
  if (score.midKeys) score.midKeys = score.midKeys.filter((m) => m.bar < bars - 1);
}

/**
 * Bars `a`…`b` taken away from every staff, whatever they hold; the bars
 * after them keep their key, metre, tempo and clef, and the repeats after
 * them move back. A repeat the bars are part of is the person's to remove
 * first, as for the last bar.
 */
export function deleteBars(score, a, b) {
  const bars = barsOf(score);
  [a, b] = [Math.min(a, b), Math.max(a, b)];
  if (a < 0 || b >= bars) throw new Error("no such bar");
  const count = b - a + 1;
  if (count >= bars) throw new Error("a score keeps one bar at least");
  if ((score.repeats ?? []).some((r) => r.from <= b && repeatEnd(r) >= a)) throw new Error("these bars are in a repeat: remove the repeat first");
  // What is in force after the bars, before they go.
  const after = { key: scoreKeyAt(score, b, Infinity), time: timeAt(score, b), tempo: tempoAt(score, b) };
  const before = a > 0 ? { key: scoreKeyAt(score, a - 1, Infinity), time: timeAt(score, a - 1), tempo: tempoAt(score, a - 1) } : { key: score.key, time: score.time, tempo: score.tempo };
  const own = changeAt(score, b + 1) ?? {};
  const clefsAfter = score.staves.map((staff, s) => (staff.voice ? null : clefAt(score, s, b, Infinity)));
  const clefsBefore = score.staves.map((staff, s) => (staff.voice ? null : a > 0 ? clefAt(score, s, a - 1, Infinity) : staff.clef));
  const from = barStart(score, a);
  const to = barStart(score, b + 1);
  for (const staff of score.staves) {
    const at = starts(staff);
    staff.events = staff.events.filter((_, k) => at[k] < from || at[k] >= to);
    mend(staff);
  }
  // The pickup gone, the piece starts on a full bar.
  if (a === 0) delete score.pickup;
  // The changes and clefs inside the bars go; those after them move back.
  const shift = (list) => (list ?? []).filter((c) => c.bar < a || c.bar > b).map((c) => (c.bar > b ? { ...c, bar: c.bar - count } : c));
  score.changes = shift(score.changes);
  if (score.midKeys) score.midKeys = shift(score.midKeys);
  // A break after a bar that goes, goes; those after the bars move back.
  score.breaks = Object.fromEntries(Object.entries(score.breaks ?? {}).filter(([bar]) => Number(bar) < a || Number(bar) > b).map(([bar, kind]) => [Number(bar) > b ? Number(bar) - count : Number(bar), kind]));
  score.staves.forEach((staff, s) => {
    if (staff.clefs) staff.clefs = shift(staff.clefs);
    if (staff.midClefs) staff.midClefs = shift(staff.midClefs);
    if (staff.voice || b + 1 >= bars) return;
    if (a === 0) staff.clef = clefsAfter[s];
    else if (clefsAfter[s] !== clefsBefore[s] && !(staff.clefs ?? []).some((c) => c.bar === a)) staff.clefs = [...(staff.clefs ?? []), { bar: a, clef: clefsAfter[s] }].sort((x, y) => x.bar - y.bar);
    if (staff.clefs && !staff.clefs.length) delete staff.clefs;
  });
  if (b + 1 < bars) {
    if (a === 0) {
      score.key = after.key;
      score.time = after.time;
      score.tempo = after.tempo;
      // Bar 0's own change is the score's setting now.
      score.changes = score.changes.filter((c) => c.bar !== 0);
    } else {
      if (own.key == null && after.key !== before.key) setChange(score, a, "key", after.key);
      if (!own.time && String(after.time) !== String(before.time)) setChange(score, a, "time", after.time);
      if (!own.tempo && JSON.stringify(after.tempo) !== JSON.stringify(before.tempo)) setChange(score, a, "tempo", after.tempo);
    }
  }
  for (const r of score.repeats ?? []) {
    if (r.from > b) {
      r.from -= count;
      r.to -= count;
    }
  }
}

/**
 * A staff whose events were taken away mended: a tie to a note that is not
 * the same any more undone, a slur's end without its start (or a start
 * without its end) taken away, and a hairpin's end without its start.
 */
function mend(staff) {
  let slur = -1;
  let hairpin = false;
  staff.events.forEach((ev, i) => {
    if (ev.tie && !sameNote(ev, staff.events[i + 1])) ev.tie = false;
    if (ev.slurEnd) {
      if (slur < 0) ev.slurEnd = false;
      slur = -1;
    }
    if (ev.slurStart) {
      if (slur >= 0) staff.events[slur].slurStart = false;
      slur = i;
    }
    if (ev.hairpinEnd && !hairpin) ev.hairpinEnd = false;
    if (ev.hairpinEnd) hairpin = false;
    if (ev.hairpin) hairpin = true;
  });
  if (slur >= 0) staff.events[slur].slurStart = false;
}

// ---- LilyPond ---------------------------------------------------------------------

const quote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Words above or below a note: a plain string, or \\markup in italics, bold, or both. */
function wordsText(t) {
  const styles = (t.bold ? "\\bold " : "") + (t.italic ? "\\italic " : "");
  return styles ? `\\markup ${styles}${quote(t.text)}` : quote(t.text);
}

function eventText(ev, beam = "") {
  // cis! and cis?: the accidental printed whatever the key says, or in parentheses.
  const reminder = (p) => (p.drum ? "" : (ev.forced ?? []).includes(p.d) ? "!" : (ev.cautionary ?? []).includes(p.d) ? "?" : "");
  const bare = (p) => p.drum ?? spellPitch(p.d, p.alter);
  const head = (p) => bare(p) + (ev.rest ? "" : reminder(p));
  const notes = (pitches, at = head) => (pitches.length === 1 ? at(pitches[0]) : `<${pitches.map(at).join(" ")}>`);
  // The stems and the beaming switched, a text span's words, before the note.
  let out = ev.stemDir != null ? `${["\\stemDown", "\\stemNeutral", "\\stemUp"][Math.sign(ev.stemDir) + 1]} ` : "";
  if (ev.noAutoBeam != null) out += ev.noAutoBeam ? "\\autoBeamOff " : "\\autoBeamOn ";
  if (ev.spanStart) out += `\\override TextSpanner.bound-details.left.text = ${quote(ev.spanStart)} `;
  // An ottava line starts (or ends) before the note, its grace notes too.
  if (ev.ottava != null) out += `\\ottava #${ev.ottava} `;
  // Fingerings and string numbers: a chord's in it, by its note; the others after the value.
  const fingers = ev.rest || ev.pitches.some((p) => p.drum) ? [] : ev.fingers ?? [];
  const fingerText = (f) => (f.circled ? `\\${f.text}` : `${f.dir < 0 ? "^" : f.dir > 0 ? "_" : "-"}${f.text}`);
  const onHead = (p) => (ev.pitches.length > 1 ? fingers.filter((f) => f.head === p.d && ev.pitches.find((q) => q.d === f.head) === p) : []);
  // Inside a chord, a note's string comes before its finger.
  const headMarks = (p) => onHead(p).sort((x, y) => Number(y.circled) - Number(x.circled)).map(fingerText).join("");
  const loose = fingers.filter((f) => !ev.pitches.some((p) => onHead(p).includes(f)));
  if (ev.graces.length && !ev.rest) {
    const graces = ev.graces.map((g) => notes(g.pitches, bare) + g.base + ".".repeat(g.dots));
    out += `\\${ev.grace ?? "grace"} ${graces.length === 1 ? graces[0] : `{ ${graces.join(" ")} }`} `;
  }
  out += ev.rest ? (ev.spacer ? "s" : "r") : ev.pitches.length > 1 ? `<${ev.pitches.map((p) => head(p) + headMarks(p)).join(" ")}>` : notes(ev.pitches);
  out += ev.base + ".".repeat(ev.dots);
  if (ev.tremolo && !ev.rest) out += `:${ev.tremolo}`;
  out += beam;
  if (ev.tie && !ev.rest) out += "~";
  if (ev.slurStart) out += "(";
  if (ev.slurEnd) out += ")";
  if (ev.phraseEnd && !ev.rest) out += "\\)";
  if (ev.phraseStart && !ev.rest) out += "\\(";
  if (ev.dynamic) out += `\\${ev.dynamic}`;
  if (ev.hairpinEnd) out += "\\!";
  if (ev.hairpin) out += HAIRPIN_WORDS.includes(ev.hairpinWords) ? `\\${ev.hairpinWords}` : ev.hairpin === "<" ? "\\<" : "\\>";
  for (const a of ev.arts) out += SCRIPTS[a] ?? "";
  out += loose.map(fingerText).join("");
  if (ev.chord) out += `^${quote(ev.chord)}`;
  for (const t of ev.texts) out += `${t.dir > 0 ? "_" : "^"}${wordsText(t)}`;
  if (ev.arpeggio && !ev.rest) out += "\\arpeggio";
  if (ev.gliss && !ev.rest) out += "\\glissando";
  // Let go before pressed again, when a note has both.
  if (ev.pedalOff) out += "\\sustainOff";
  if (ev.pedalOn) out += "\\sustainOn";
  // What LilyPond reads as commands after the note: a tie let ring or repeated, a text span, a breath.
  if (ev.lv && !ev.rest) out += "\\laissezVibrer";
  if (ev.repeatTie && !ev.rest) out += "\\repeatTie";
  if (ev.spanEnd) out += "\\stopTextSpan";
  if (ev.spanStart != null) out += "\\startTextSpan";
  if (BREATHS.includes(ev.breath)) out += ` \\${ev.breath}`;
  return out;
}

/**
 * Which notes take no syllable of their own: a note tied from the one
 * before, and every note after the first under a slur — LilyPond's
 * melismata, which eui-score follows when it sets \addlyrics.
 */
export function melismata(staff) {
  let tied = false;
  let slur = false;
  return staff.events.map((ev) => {
    if (ev.rest) {
      tied = false;
      return true;
    }
    const continuation = tied || (slur && !ev.slurStart);
    tied = ev.tie;
    if (ev.slurStart) slur = true;
    if (ev.slurEnd) slur = false;
    return continuation;
  });
}

function lyricText(staff, verse = 1) {
  const words = [];
  const skip = melismata(staff);
  for (const [i, ev] of staff.events.entries()) {
    if (!skip[i]) {
      const l = syllableOf(ev, verse);
      if (l) {
        const text = /^[\p{L}\p{N}'’.,!?;:]+$/u.test(l.text) ? l.text : quote(l.text);
        words.push(text + (l.hyphen ? " --" : "") + (l.extend ? " __" : ""));
      } else {
        words.push("_");
      }
    }
  }
  while (words.length && words[words.length - 1] === "_") words.pop();
  // A verse with no words before one that has some keeps its line.
  return words.length ? words.join(" ") : "_";
}

/**
 * The score as LilyPond, absolute pitches, a bar check at every bar line.
 * `items` maps each note and rest, in the order eui-score numbers them, to
 * its lane and event. `open` lists bars of other voices to write even when
 * they hold only rests — where the page is writing in them — as
 * `[{ staff: lane, bar }]`. `unfold` plays every repeat out, for the MIDI:
 * no repeat signs, the bars in the order they sound (see `playOrder`).
 */
export function toLilyPond(score, { open = [], unfold = false, written = false } = {}) {
  const items = [];
  const header = Object.entries(score.header).filter(([, v]) => v).map(([k, v]) => `${k} = ${quote(v)}`).join(" ");
  const repeats = score.repeats ?? [];
  const staves = staffLanes(score).map((s) => {
    const staff = score.staves[s];
    const upper = staffBars(score, staff, s);
    // The other voices, each its bars: a bar is written in voices up to the
    // last that sounds there (or that the page writes in), those before it as they are.
    const others = voiceLanes(score, s).slice(1).map((lane) => ({ lane, bars: staffBars(score, score.staves[lane], lane) }));
    const voicesIn = (b) => {
      const shown = (o) => o.bars[b] && (sounding(o.bars[b].events) || open.some((x) => x.staff === o.lane && x.bar === b));
      let last = others.length - 1;
      while (last >= 0 && !shown(others[last])) last--;
      return others.slice(0, last + 1).map((o) => o.bars[b]);
    };
    const top = staffNumber(score, s) === 0;
    // Under \compressMMRests, bars of rest side by side are written R1*n: gathered.
    const gathered = !unfold && score.compress ? restRuns(score, upper, voicesIn, repeats) : [];
    const bars = upper.map((bar, b) => {
      const broken = top && b > 0 ? { line: "\\break ", page: "\\pageBreak " }[(score.breaks ?? {})[b - 1]] ?? "" : "";
      const run = gathered[b];
      if (run === null) return null;
      if (run) {
        // One item: the run's first rest.
        items.push(bar.items[0]);
        return broken + changesText(score, s, b) + (top ? markText(score, b) : "") + run.text + (top ? jumpText(score, b + run.bars - 1) : "");
      }
      const voices = voicesIn(b);
      items.push(...bar.items, ...voices.flatMap((v) => v.items));
      // A voice drawn as nothing in the bar (spacers) is not counted among the voices:
      // past two, each then says which it is, so voice 3 stays voice 3.
      const named = voices.length > 1 && voices.some((v) => v.events.every((ev) => ev.rest && ev.spacer));
      const parts = [bar, ...voices].map((v, k) => `{ ${named ? `\\voice${VOICE_NAMES[k]} ` : ""}${v.text} }`);
      const music = voices.length ? `<< ${parts.join(" \\\\ ")} >>` : bar.text;
      return broken + changesText(score, s, b) + (top ? markText(score, b) : "") + music + (top ? jumpText(score, b) : "");
    });
    const music = unfold ? playedOut(score, s, bars) : withRepeats(bars, repeats);
    const lastRepeat = !unfold && repeats.find((r) => r.endings.length === 0 && r.to === bars.length - 1);
    const name = staff.name ? `instrumentName = ${quote(staff.name)} ` : "";
    const short = staff.short ? `shortInstrumentName = ${quote(staff.short)} ` : "";
    const midi = staff.instrument && !staff.drums ? `midiInstrument = ${quote(staff.instrument)} ` : "";
    const tempo = s === 0 && score.tempo && (score.tempo.text || score.tempo.bpm) ? ` ${tempoText(score.tempo)}` : "";
    const clef = clefText(staff.clef);
    const time = staff.time ?? score.time;
    const partial = score.pickup > 0 ? ` \\partial ${pickupText(score.pickup)}` : "";
    const settings = name + short + midi;
    // A piece that ends on a repeat's end keeps its :|. sign, not a final bar.
    const ending = lastRepeat ? "" : ' \\bar "|."';
    // Written pitch: a transposing instrument's staff, key and all, where it is read.
    const moved = written ? transpositionOf(staff) : null;
    const brace = moved ? `\\transpose c ${moved} {` : "{";
    // A drum staff: its strokes in \\drummode, with no clef and no key.
    const opening = staff.drums
      ? `\\new DrumStaff ${settings ? `\\with { ${settings}} ` : ""}\\drummode {\n  \\time ${timeText(score, time)}${partial}${tempo}`
      : `\\new Staff ${settings ? `\\with { ${settings}} ` : ""}${brace}\n  \\clef ${clef} \\key ${keyText(keyOf(score, s), score.mode)} \\time ${timeText(score, time)}${partial}${tempo}`;
    let out = `${opening}\n  ${music.replace(/\n {4}/g, "\n  ")}${ending}\n}`;
    // Each verse a line under the one before.
    for (let verse = 1; verse <= versesOf(staff); verse++) out += `\n\\addlyrics { ${lyricText(staff, verse)} }`;
    return out;
  });
  const kinds = { brace: "\\new PianoStaff", bracket: "\\new StaffGroup", choir: "\\new ChoirStaff" };
  const indent = (text) => text.replace(/^/gm, "  ");
  // Staves `from`…`to`, each group among `groups` that starts there around its staves.
  const nest = (from, to, groups) => {
    const out = [];
    let n = from;
    while (n <= to) {
      const g = groups.filter((x) => x.first === n && x.last <= to).sort((x, y) => y.last - x.last)[0];
      if (!g) {
        out.push(staves[n]);
        n++;
        continue;
      }
      const names = (g.name ? `instrumentName = ${quote(g.name)} ` : "") + (g.short ? `shortInstrumentName = ${quote(g.short)} ` : "");
      const inner = nest(g.first, g.last, groups.filter((x) => x !== g));
      out.push(`${kinds[g.kind]} ${names ? `\\with { ${names}} ` : ""}<<\n${indent(inner)}\n>>`);
      n = g.last + 1;
    }
    return out.join("\n");
  };
  const groups = (score.groups ?? []).filter((g) => kinds[g.kind] && g.first <= g.last && g.last < staves.length);
  const group = kinds[score.group] ?? "";
  const body = staves.length > 1 || group ? `${group ? group + " " : ""}<<\n${indent(nest(0, staves.length - 1, groups))}\n>>` : staves[0];
  // Bars of rest gathered on every staff: a part's long rests, as one bar.
  const gathering = score.compress ? "\\compressMMRests " : "";
  const source = pageText(score) + (header ? `\\header { ${header} }\n` : "") + gathering + body + "\n";
  // What is not notation (the mixer, the notes' velocities…) rides along at the end, as a comment.
  return { source: unfold || !score.meta ? source : writeMeta(source, score.meta), items };
}

// ---- What is not notation, kept in the text --------------------------------------
//
// The mixer, each note's velocity and the like are kept in the LilyPond
// itself, on one last line the engraver reads as a comment:
//
//   %% eui-score {"mixer":{…},"velocity":{…}}
//
// one JSON object whose keys are per feature. History, sharing and saving
// then keep them with the notes.

const META = /^%% eui-score (.*)$/m;

/** The object on the text's `%% eui-score` line: {} when there is none, or when it does not read. */
export function readMeta(source) {
  const line = META.exec(source ?? "");
  if (!line) return {};
  try {
    const read = JSON.parse(line[1]);
    return read && typeof read === "object" && !Array.isArray(read) ? read : {};
  } catch {
    return {};
  }
}

/**
 * `source` with `obj`'s keys merged into its `%% eui-score` line, the
 * others kept; a key set to null (or undefined) goes. The line is the last
 * one; no line when nothing is left.
 */
export function writeMeta(source, obj) {
  const meta = { ...readMeta(source) };
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (value == null) delete meta[key];
    else meta[key] = value;
  }
  const text = (source ?? "").replace(/^%% eui-score .*$\n?/m, "").replace(/\n*$/, "\n");
  return Object.keys(meta).length ? `${text}%% eui-score ${JSON.stringify(meta)}\n` : text;
}

/**
 * The runs of bars of rest a lane gathers under \\compressMMRests: `runs[b]`
 * is `{ text: "R1*4", bars: 4 }` on a run's first bar, null on the bars after
 * it, undefined elsewhere. A bar of rest is a bar of bare rests, no voice
 * beside them, whose length is one value (R1, R2.); a run stops where
 * something is written at a bar line — a change, a mark, a break, a jump, a
 * repeat's edge — and never gathers a pickup.
 */
function restRuns(score, upper, voicesIn, repeats) {
  const edges = new Set();
  for (const r of repeats) {
    let next = r.to + 1;
    edges.add(r.from).add(next);
    for (const len of r.endings) edges.add((next += len));
  }
  const restOf = (b) => {
    if ((b === 0 && score.pickup > 0) || voicesIn(b).length) return null;
    const events = upper[b].events;
    if (!events.length || !events.every((ev) => isBareRest(ev) && !ev.spacer)) return null;
    const value = spellDuration(barLength(score, b));
    return value.length === 1 ? `R${value[0].base}${".".repeat(value[0].dots)}` : null;
  };
  const quiet = (b) => !edges.has(b) && !score.staves.some((_, s) => changesText(score, s, b)) && !markText(score, b) && !(score.breaks ?? {})[b - 1] && !jumpText(score, b - 1);
  const runs = [];
  let b = 0;
  while (b < upper.length) {
    const rest = restOf(b);
    if (!rest) {
      b++;
      continue;
    }
    let n = 1;
    while (b + n < upper.length && restOf(b + n) === rest && quiet(b + n)) n++;
    runs[b] = { text: n > 1 ? `${rest}*${n}` : rest, bars: n };
    for (let k = 1; k < n; k++) runs[b + k] = null;
    b += n;
  }
  return runs;
}

const clefText = (clef) => (CLEFS.includes(clef) ? (clef.includes("_") ? `"${clef}"` : clef) : "treble");
const tempoText = (tempo) => `\\tempo ${tempo.text ? quote(tempo.text) + " " : ""}${tempo.bpm ? `${tempo.base} = ${tempo.bpm}` : ""}`.trimEnd();

/** What staff `s` writes at the start of bar `b` for what changes there. */
// ---- Marks, and the jumps they make -------------------------------------------------
//
// A bar's `mark` stands over its first bar line: a rehearsal letter
// (`\mark \default`, lettered A, B… as the marks come), a segno or a coda.
// Its `jump` is written at its end (`\\jump`, `\\fine`), in italics, against
// its last bar line: D.S. and D.C.
// send the music back, Fine ends it there the second time, To Coda jumps
// to the coda the second time. Both are the first staff's to write.

export const MARKS = ["letter", "segno", "coda"];
export const JUMPS = { ds: "D.S.", "ds-fine": "D.S. al Fine", "ds-coda": "D.S. al Coda", dc: "D.C.", "dc-fine": "D.C. al Fine", "dc-coda": "D.C. al Coda", fine: "Fine", "to-coda": "To Coda" };

function markText(score, b) {
  const mark = changeAt(score, b)?.mark;
  if (!mark) return "";
  return { letter: "\\mark \\default ", segno: "\\segnoMark ", coda: "\\codaMark " }[mark] ?? "";
}

function jumpText(score, b) {
  const jump = changeAt(score, b)?.jump;
  if (jump === "fine") return " \\fine";
  return JUMPS[jump] ? ` \\jump ${quote(JUMPS[jump])}` : "";
}

/** Bar `b`'s mark: "letter", "segno", "coda", or null to take it away. */
export function setMark(score, b, mark) {
  if (b < 0 || b >= barsOf(score)) throw new Error("no such bar");
  if (mark != null && !MARKS.includes(mark)) throw new Error("no such mark");
  setChange(score, b, "mark", changeAt(score, b)?.mark === mark ? null : mark);
}

/** The jump at the end of bar `b` (a key of JUMPS), or null to take it away. */
export function setJump(score, b, jump) {
  if (b < 0 || b >= barsOf(score)) throw new Error("no such bar");
  if (jump != null && !JUMPS[jump]) throw new Error("no such jump");
  if (jump?.startsWith("ds") && !(score.changes ?? []).some((c) => c.mark === "segno" && c.bar <= b)) throw new Error("a D.S. goes back to a segno: put one on an earlier bar first");
  setChange(score, b, "jump", changeAt(score, b)?.jump === jump ? null : jump);
}

/** The sustain pedal at event `i`: "on" pressed, "off" let go, "change" both, toggled; null takes it away. */
export function setPedal(score, s, i, how) {
  const ev = noteOf(score, s, i);
  const want = { on: [true, false], off: [false, true], change: [true, true] }[how] ?? [false, false];
  const same = ev.pedalOn === want[0] && ev.pedalOff === want[1];
  [ev.pedalOn, ev.pedalOff] = same ? [false, false] : want;
}

/** Event `i`'s words of `style`: "staff" text above it, upright, or "expression" below, in italics; empty takes them away. */
export function setText(score, s, i, style, text) {
  const ev = noteOf(score, s, i);
  const italic = style === "expression";
  const kept = ev.texts.filter((t) => Boolean(t.italic) !== italic);
  const was = ev.texts.find((t) => Boolean(t.italic) === italic);
  const words = String(text ?? "").trim();
  // Bold words stay bold when they are changed.
  ev.texts = words ? [...kept, { text: words, dir: italic ? 1 : -1, italic, ...(was?.bold ? { bold: true } : {}) }] : kept;
}

/** Event `i`'s words of `style`, as setText writes them; "" when it has none. */
export function textOf(ev, style) {
  return ev.texts.find((t) => Boolean(t.italic) === (style === "expression"))?.text ?? "";
}

function changesText(score, s, b) {
  if (b === 0) return "";
  const parts = [];
  const drums = isDrums(score, s);
  const clef = (score.staves[s].clefs ?? []).find((c) => c.bar === b);
  if (clef && !drums) parts.push(`\\clef ${clefText(clef.clef)}`);
  const c = changeAt(score, b);
  if (c?.key != null && !drums) parts.push(`\\key ${keyText(keyOf(score, s, barStart(score, b)), c.mode)}`);
  if (c?.time) parts.push(`\\time ${c.time[0]}/${c.time[1]}`);
  if (c?.tempo && staffNumber(score, s) === 0) parts.push(tempoText(c.tempo));
  if (c?.line) parts.unshift(`\\bar "${c.line}"`);
  return parts.length ? parts.join(" ") + " " : "";
}

/**
 * The beams written by hand that a lane keeps: [ on the note it starts on, ]
 * on its last — each opened and closed in one bar, in one tuplet, on notes
 * of an eighth or shorter. A beam an edit broke is left out, never written
 * half. Answers `beam[i]`, what event `i` writes: "[", "]" or "".
 */
export function handBeams(score, staff) {
  const at = starts(staff);
  const beam = staff.events.map(() => "");
  let open = -1;
  staff.events.forEach((ev, i) => {
    if (open >= 0 && (barAt(score, at[i]) !== barAt(score, at[open]) || ev.tuplet?.id !== staff.events[open].tuplet?.id || (!ev.rest && ev.base < 8))) open = -1;
    if (ev.beamEnd && open >= 0 && i > open && !ev.rest) {
      beam[open] = "[";
      beam[i] = "]";
      open = -1;
    }
    if (ev.beamStart && !ev.rest && ev.base >= 8) open = i;
  });
  return beam;
}

/**
 * The changes of clef and key inside bars that lane `s` writes (a staff's
 * first voice; a drum staff none), each `{ bar, pos, text }`, in order.
 */
function midChanges(score, s) {
  const staff = score.staves[s];
  if (staff.voice || staff.drums) return [];
  const own = staff.key == null ? 0 : staff.key - score.key;
  const keys = (score.midKeys ?? []).map((m) => ({ bar: m.bar, pos: m.pos, order: 1, text: `\\key ${keyText(Math.max(-7, Math.min(7, m.key + own)), m.mode)}` }));
  const clefs = (staff.midClefs ?? []).map((c) => ({ bar: c.bar, pos: c.pos, order: 0, text: `\\clef ${clefText(c.clef)}` }));
  return [...clefs, ...keys].sort((x, y) => x.bar - y.bar || x.pos - y.pos || x.order - y.order);
}

/** A lane's music, a string per bar, with its events and items; a tuplet never leaves its bar. */
function staffBars(score, staff, s) {
  const beams = handBeams(score, staff);
  // The changes inside bars, each before the event it falls at (or the first after it).
  const mids = midChanges(score, s);
  let next = 0;
  const bars = [];
  let current = { parts: [], items: [], events: [] };
  let t = 0;
  let open = null;
  const close = () => {
    if (open !== null) current.parts.push("}");
    open = null;
    bars.push({ text: current.parts.join(" "), items: current.items, events: current.events });
    current = { parts: [], items: [], events: [] };
  };
  staff.events.forEach((ev, i) => {
    current.items.push({ staff: s, index: i });
    current.events.push(ev);
    const tid = ev.tuplet?.id ?? null;
    if (open !== null && tid !== open) {
      current.parts.push("}");
      open = null;
    }
    const b = bars.length;
    const pos = t - barStart(score, b);
    // One no event starts at is written before the first after it, the next bar's first at the latest.
    while (next < mids.length && (mids[next].bar < b || (mids[next].bar === b && mids[next].pos <= pos + 1e-6))) current.parts.push(mids[next++].text);
    if (tid !== null && open === null) {
      current.parts.push(`\\tuplet ${ev.tuplet.n}/${ev.tuplet.d} {`);
      open = tid;
    }
    current.parts.push(eventText(ev, beams[i]));
    t += ticksOf(ev);
    if (Math.abs(t - barStart(score, bars.length + 1)) < 1e-6) close();
  });
  if (current.parts.length) close();
  return bars;
}

/** Bars joined with bar checks; a bar gathered into the one before it (null) is not written. */
const checked = (bars) => bars.filter((bar) => bar !== null).join(" | ");

/** The bars joined with bar checks, each repeat around its bars and its endings after it. */
function withRepeats(bars, repeats) {
  const groups = [];
  let b = 0;
  while (b < bars.length) {
    const r = repeats.find((x) => x.from === b);
    if (!r) {
      groups.push(bars[b]);
      b++;
      continue;
    }
    let text = `\\repeat volta ${Math.max(r.times ?? 2, r.endings.length)} { ${checked(bars.slice(r.from, r.to + 1))} }`;
    let next = r.to + 1;
    if (r.endings.length) {
      const alts = r.endings.map((len) => {
        const ending = checked(bars.slice(next, next + len));
        next += len;
        return `{ ${ending} }`;
      });
      text += ` \\alternative { ${alts.join(" ")} }`;
    }
    groups.push(text);
    b = next;
  }
  return groups.filter((g) => g !== null).map((g, k) => (k > 0 && k % 4 === 0 ? "\n    " : "") + g).join(" | ").replace(/ \| \n {4}/g, " |\n    ");
}

// ---- Repeats ---------------------------------------------------------------------------------
//
// A repeat is bars, the same on every staff: `from` and `to` its body, and
// `endings` the length in bars of each ending after it ("1.", "2."…).

/** The repeats read from the signs the parser met, in bars; null when they do not nest as repeats do. */
function repeatsFrom(signs) {
  const out = [];
  let open = null;
  let endings = null;
  let volta = null;
  const close = () => {
    if (open === null) return;
    // Played more times than its endings say: \\repeat volta 3.
    out.push({ from: open.from, to: open.to, endings: endings ?? [], ...(open.times > Math.max(2, (endings ?? []).length) ? { times: open.times } : {}) });
    open = null;
    endings = null;
  };
  for (const { mark, at, times } of signs) {
    if (mark === "start") {
      if (open && open.to === null) return null;
      close();
      open = { from: at, to: null, times };
    } else if (mark === "end") {
      // A repeat's body ends here — unless an ending is running, whose own end it is.
      if (volta !== null) continue;
      if (!open) open = { from: 0, to: null };
      if (open.to === null) open.to = at - 1;
      if (!endings) close();
    } else if (mark === "volta") {
      if (!open) return null;
      if (open.to === null) open.to = at - 1;
      endings ??= [];
      volta = at;
    } else if (mark === "volta-end") {
      if (volta === null) return null;
      endings.push(at - volta);
      volta = null;
    }
  }
  close();
  return out.every((r) => r.to >= r.from && r.endings.every((n) => n > 0)) ? out : null;
}

/** The repeat bar `b` is in — its body or an ending — or null. */
export function repeatAt(score, b) {
  return (score.repeats ?? []).find((r) => b >= r.from && b <= r.to + r.endings.reduce((x, y) => x + y, 0)) ?? null;
}

/** Bars `a`…`b` repeated; the same bars again take the repeat away. */
export function toggleRepeat(score, a, b) {
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  score.repeats ??= [];
  const same = score.repeats.findIndex((r) => r.from === from && r.to === to);
  if (same >= 0) {
    score.repeats.splice(same, 1);
    return;
  }
  if (score.repeats.some((r) => from <= r.to + r.endings.reduce((x, y) => x + y, 0) && to >= r.from)) {
    throw new Error("those bars are already in a repeat: remove it first");
  }
  if (to >= barsOf(score)) throw new Error("no such bars");
  score.repeats.push({ from, to, endings: [] });
  score.repeats.sort((x, y) => x.from - y.from);
}

/** The repeat around bar `b` taken away; its bars and notes stay. */
export function removeRepeat(score, b) {
  const r = repeatAt(score, b);
  if (!r) throw new Error("there is no repeat there");
  score.repeats.splice(score.repeats.indexOf(r), 1);
}

/**
 * Endings for a repeat. Bars `a`…`b`, the last bars of a repeat, become its
 * first ending, and as many empty bars after them its second. On a repeat
 * that has its endings, an empty ending more is added after the last.
 */
export function addEndings(score, a, b) {
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  const r = repeatAt(score, from);
  if (!r) throw new Error("select the bars of a repeat — its last ones become its first ending");
  if (r.endings.length) {
    const last = r.endings[r.endings.length - 1];
    const at = r.to + r.endings.reduce((x, y) => x + y, 0) + 1;
    insertBars(score, at, last);
    r.endings.push(last);
    return;
  }
  if (to !== r.to) throw new Error("the first ending is the repeat's last bars: select up to its end");
  if (from <= r.from) throw new Error("leave a bar before the first ending");
  const len = to - from + 1;
  r.to = from - 1;
  insertBars(score, to + 1, len);
  r.endings = [len, len];
}

/** The last bar a repeat spans, endings included. */
export function repeatEnd(r) {
  return r.to + r.endings.reduce((x, y) => x + y, 0);
}

/**
 * Repeat `i` given new bounds — what dragging its edges does: a body from
 * `from` to `to`, and each ending's length. Refused when it would leave the
 * score, overlap another repeat, or leave a part with no bar.
 */
export function setRepeat(score, i, next) {
  const r = score.repeats?.[i];
  if (!r) throw new Error("there is no such repeat");
  const candidate = { from: next.from ?? r.from, to: next.to ?? r.to, endings: [...(next.endings ?? r.endings)], ...(r.times ? { times: r.times } : {}) };
  if (candidate.from < 0 || candidate.to < candidate.from) throw new Error("a repeat keeps one bar at least");
  if (candidate.endings.some((n) => !Number.isInteger(n) || n < 1)) throw new Error("an ending keeps one bar at least");
  if (candidate.endings.length === 1) throw new Error("a repeat has two endings at least, or none");
  if (repeatEnd(candidate) >= barsOf(score)) throw new Error("the repeat would run past the last bar");
  const others = score.repeats.filter((_, k) => k !== i);
  if (others.some((o) => candidate.from <= repeatEnd(o) && repeatEnd(candidate) >= o.from)) throw new Error("the repeat would run into another one");
  score.repeats[i] = candidate;
}

/**
 * Bars `a`…`b` made the next ending of the repeat before them: right after
 * its last part, they are its next ending; the last bars of a repeat with no
 * endings become its first ending ("1."), its body ending before them.
 */
export function endingFromBars(score, a, b) {
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  const len = to - from + 1;
  const repeats = score.repeats ?? [];
  // Right after a repeat's endings: one more.
  const next = repeats.findIndex((r) => r.endings.length && repeatEnd(r) + 1 === from);
  if (next >= 0) {
    const count = repeats[next].endings.length;
    setRepeat(score, next, { endings: [...repeats[next].endings, len] });
    return count;
  }
  // Otherwise the bars become the first ending, and as many bars after them the
  // second: one ending alone would be the last time through, with no repeat sign.
  const plain = repeats.findIndex((r) => !r.endings.length && (repeatEnd(r) + 1 === from || (from > r.from && to === r.to)));
  if (plain < 0) throw new Error("select the bars right after a repeat, or its last bars: they become its first ending");
  const r = repeats[plain];
  const body = from > r.to ? r.to : from - 1;
  const taken = repeats.some((o) => o !== r && o.from <= to + len && repeatEnd(o) > to);
  if (taken || to + len >= barsOf(score)) insertBars(score, to + 1, len);
  setRepeat(score, plain, { to: body, endings: [len, len] });
  return 1;
}

/** `count` bars of rests put in every staff before bar `at`; the repeats after it move along. */
export function insertBars(score, at, count) {
  if (at === 0 && score.pickup > 0) throw new Error("the pickup starts the piece: bars go after it");
  const t = barStart(score, at);
  if (score.staves.some((staff) => t > lengthOf(staff))) throw new Error("no such bar");
  // What changes from bar `at` moves along: the new bars keep the metre before them.
  for (const c of score.changes ?? []) if (c.bar >= at) c.bar += count;
  for (const staff of score.staves) for (const c of [...(staff.clefs ?? []), ...(staff.midClefs ?? [])]) if (c.bar >= at) c.bar += count;
  for (const m of score.midKeys ?? []) if (m.bar >= at) m.bar += count;
  const ticks = barStart(score, at + count) - t;
  for (const staff of score.staves) {
    const i = t === lengthOf(staff) ? staff.events.length : eventAt(staff, t);
    if (i < 0) throw new Error("bars must start at a bar line");
    staff.events.splice(i, 0, ...rests(score, t, ticks));
  }
  for (const r of score.repeats ?? []) {
    if (r.from >= at) r.from += count;
    if (r.to >= at) r.to += count;
  }
  // A break stays after its bar: those from bar `at` on move along.
  score.breaks = Object.fromEntries(Object.entries(score.breaks ?? {}).map(([bar, kind]) => [Number(bar) >= at ? Number(bar) + count : Number(bar), kind]));
}

// ---- Sharing ----------------------------------------------------------------------------------
//
// A score travels in a link: its text, deflated, in base64url, after `#s=`.
// The part after # never reaches the server, so the score is in the link
// and nowhere else.

/** The text as a link's code. */
export async function shareCode(text) {
  const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The text a link's code holds; throws on a code that is not one. */
export async function fromShareCode(code) {
  const binary = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
}

// ---- Refusals ---------------------------------------------------------------------------------

/**
 * Where an engraver's refusal of `text` points, as a place a person can go
 * to: `{ at, line, message }` — `at` an index into the JavaScript string,
 * the message saying "line N" — or null when it names no place.
 *
 * The engraver counts characters (Unicode scalar values), and for a block
 * never closed it names the block it was reading; the one left open is
 * found here, the innermost — most often the one just typed.
 */
export function refusalPlace(message, text) {
  let at = null;
  const said = /\(at character (\d+)\)/.exec(message);
  if (said) at = Array.from(text).slice(0, Number(said[1])).join("").length;
  const open = /'\{' that is never closed/.test(message) ? ["{", "}"] : /<< that is never closed/.test(message) ? ["<<", ">>"] : null;
  if (open) at = unclosed(text, open[0], open[1]) ?? at;
  if (at == null) return null;
  const line = text.slice(0, at).split("\n").length;
  const plain = message.replace(/\s*\(at character \d+\)/, "").replace(/^score:\s*/, "").replace(/^./, (c) => c.toUpperCase());
  return { at, line, message: `${plain}, line ${line}` };
}

/**
 * The `open` never closed by `close` in a LilyPond text, past strings and
 * comments; null when all are closed. A `close` first on its line closes
 * the `open` of the line indented as much — as the editor writes it, and as
 * people do — so a block left open inside it is the one named, not the
 * staff around it. Otherwise the innermost left open.
 */
function unclosed(text, open, close) {
  const stack = [];
  const skipped = [];
  const indentAt = (i) => {
    const start = text.lastIndexOf("\n", i - 1) + 1;
    return /^[ \t]*/.exec(text.slice(start))[0].length;
  };
  const firstOnLine = (i) => /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i));
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "%" && text[i + 1] === "{") {
      const end = text.indexOf("%}", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === "%") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
    } else if (text.startsWith(open, i)) {
      stack.push({ at: i, indent: indentAt(i) });
      i += open.length;
    } else if (text.startsWith(close, i)) {
      let k = stack.length - 1;
      if (firstOnLine(i)) {
        const indent = indentAt(i);
        while (k >= 0 && stack[k].indent !== indent) k--;
        if (k < 0) k = stack.length - 1;
      }
      skipped.push(...stack.splice(k + 1).map((b) => b.at));
      stack.pop();
      i += close.length;
    } else i++;
  }
  if (skipped.length) return skipped[skipped.length - 1];
  return stack.length ? stack[stack.length - 1].at : null;
}

// ---- Instruments ------------------------------------------------------------------------------
//
// What the editor offers for a staff: its name, its short name, its clef,
// and the General MIDI sound it plays (LilyPond's midiInstrument, which
// eui-score turns into a program). A null clef keeps the staff's own: a
// keyboard's two staves are not in the same clef.

const preset = (family, name, short, sound, clef) => ({ family, name, short, sound, clef });

export const INSTRUMENTS = [
  preset("Keyboards", "Piano", "Pno.", "acoustic grand", null),
  preset("Keyboards", "Electric piano", "E.Pno.", "electric piano 1", null),
  preset("Keyboards", "Harpsichord", "Hpsd.", "harpsichord", null),
  preset("Keyboards", "Organ", "Org.", "church organ", null),
  preset("Keyboards", "Accordion", "Acc.", "accordion", null),
  preset("Keyboards", "Celesta", "Cel.", "celesta", null),
  preset("Strings", "Violin", "Vl.", "violin", "treble"),
  preset("Strings", "Viola", "Va.", "viola", "alto"),
  preset("Strings", "Cello", "Vc.", "cello", "bass"),
  preset("Strings", "Double bass", "Cb.", "contrabass", "bass"),
  preset("Strings", "Strings", "Str.", "string ensemble 1", null),
  preset("Strings", "Harp", "Hp.", "orchestral harp", null),
  preset("Woodwinds", "Piccolo", "Picc.", "piccolo", "treble"),
  preset("Woodwinds", "Flute", "Fl.", "flute", "treble"),
  preset("Woodwinds", "Recorder", "Rec.", "recorder", "treble"),
  preset("Woodwinds", "Oboe", "Ob.", "oboe", "treble"),
  preset("Woodwinds", "English horn", "E.H.", "english horn", "treble"),
  preset("Woodwinds", "Clarinet in B♭", "Cl.", "clarinet", "treble"),
  preset("Woodwinds", "Clarinet in A", "Cl. A", "clarinet", "treble"),
  preset("Woodwinds", "Bassoon", "Bsn.", "bassoon", "bass"),
  preset("Woodwinds", "Soprano sax", "S.Sax.", "soprano sax", "treble"),
  preset("Woodwinds", "Alto sax", "A.Sax.", "alto sax", "treble"),
  preset("Woodwinds", "Tenor sax", "T.Sax.", "tenor sax", "treble"),
  preset("Woodwinds", "Baritone sax", "B.Sax.", "baritone sax", "treble"),
  preset("Brass", "Trumpet in B♭", "Tpt.", "trumpet", "treble"),
  preset("Brass", "Trumpet in C", "Tpt. C", "trumpet", "treble"),
  preset("Brass", "Horn in F", "Hn.", "french horn", "treble"),
  preset("Brass", "Trombone", "Tbn.", "trombone", "bass"),
  preset("Brass", "Tuba", "Tba.", "tuba", "bass"),
  preset("Guitars", "Guitar", "Gtr.", "acoustic guitar (nylon)", "treble_8"),
  preset("Guitars", "Steel-string guitar", "Gtr.", "acoustic guitar (steel)", "treble_8"),
  preset("Guitars", "Electric guitar", "E.Gtr.", "electric guitar (clean)", "treble_8"),
  preset("Guitars", "Bass guitar", "B.Gtr.", "electric bass (finger)", "bass_8"),
  preset("Guitars", "Banjo", "Bjo.", "banjo", "treble_8"),
  preset("Voices", "Voice", "V.", "choir aahs", "treble"),
  preset("Voices", "Soprano", "S.", "choir aahs", "treble"),
  preset("Voices", "Alto", "A.", "choir aahs", "treble"),
  preset("Voices", "Tenor", "T.", "choir aahs", "treble_8"),
  preset("Voices", "Bass", "B.", "choir aahs", "bass"),
  { family: "Percussion", name: "Drum kit", short: "Dr.", sound: "", clef: "percussion", drums: true },
  preset("Percussion", "Timpani", "Timp.", "timpani", "bass"),
  preset("Percussion", "Glockenspiel", "Glk.", "glockenspiel", "treble"),
  preset("Percussion", "Xylophone", "Xyl.", "xylophone", "treble"),
  preset("Percussion", "Marimba", "Mar.", "marimba", "treble"),
  preset("Percussion", "Vibraphone", "Vib.", "vibraphone", "treble"),
  preset("Percussion", "Tubular bells", "T.B.", "tubular bells", "treble"),
];

// ---- Drums ------------------------------------------------------------------------------------
//
// A drum staff (`\new DrumStaff \drummode`) holds strokes, not pitches: each
// head is a drum, drawn where eui-score draws it (`d`, as a pitch would be on
// a percussion staff) and played on General MIDI's drum channel (`key`).

/** The drums the palette offers, by \drummode's names. */
export const DRUMS = [
  { name: "bd", label: "Kick", d: 4, key: 36 },
  { name: "sn", label: "Snare", d: 8, key: 38 },
  { name: "ss", label: "Side stick", d: 8, key: 37 },
  { name: "hh", label: "Hi-hat", d: 10, key: 42 },
  { name: "hho", label: "Open hi-hat", d: 10, key: 46 },
  { name: "hhp", label: "Pedal hi-hat", d: 2, key: 44 },
  { name: "cymc", label: "Crash", d: 12, key: 49 },
  { name: "cymr", label: "Ride", d: 12, key: 51 },
  { name: "rb", label: "Ride bell", d: 12, key: 53 },
  { name: "tomh", label: "High tom", d: 11, key: 50 },
  { name: "tommh", label: "Mid tom", d: 9, key: 48 },
  { name: "tomml", label: "Low-mid tom", d: 7, key: 47 },
  { name: "toml", label: "Low tom", d: 6, key: 45 },
  { name: "tomfh", label: "Floor tom", d: 5, key: 43 },
  { name: "tomfl", label: "Low floor tom", d: 3, key: 41 },
  { name: "hc", label: "Hand clap", d: 8, key: 39 },
  { name: "cb", label: "Cowbell", d: 12, key: 56 },
  { name: "tamb", label: "Tambourine", d: 12, key: 54 },
];

// The other drums \drummode names, read and written back but not offered.
const MORE_DRUMS = [
  { name: "bda", d: 4, key: 35 }, { name: "sne", d: 8, key: 40 }, { name: "cymcb", d: 12, key: 57 },
  { name: "cymrb", d: 12, key: 59 }, { name: "cymch", d: 12, key: 52 }, { name: "cyms", d: 12, key: 55 },
  { name: "vibs", d: 11, key: 58 },
];

/** Drum `name` as a head: where it is drawn, and its name. */
export function drumPitch(name) {
  const drum = DRUMS.find((x) => x.name === name) ?? MORE_DRUMS.find((x) => x.name === name);
  if (!drum) throw new Error(`no drum called ${name}`);
  return { d: drum.d, alter: 0, drum: drum.name };
}

/** The drum General MIDI key `key` plays, by name, or null. */
export function drumByKey(key) {
  return (DRUMS.find((x) => x.key === key) ?? MORE_DRUMS.find((x) => x.key === key))?.name ?? null;
}

/** A drum's General MIDI key. */
export function drumKey(name) {
  return (DRUMS.find((x) => x.name === name) ?? MORE_DRUMS.find((x) => x.name === name))?.key ?? 38;
}

/** Whether lane `s` is a drum staff's. */
export function isDrums(score, s) {
  return Boolean(score.staves[upperOf(score, s)]?.drums);
}

function refuseDrums(score, s) {
  if (isDrums(score, s)) throw new Error("A drum staff has drums, not pitches: the drum buttons write and change them");
}

/** Lane `s`'s event `i` struck on drum `name` — instead of what it was, or `add`ed to it. */
export function drumHit(score, s, i, name, add = false) {
  if (!isDrums(score, s)) throw new Error("Drums go on a drum staff: add one with + Staff, Drum kit");
  const ev = noteOf(score, s, i);
  const p = drumPitch(name);
  if (ev.rest || !add) {
    Object.assign(ev, { rest: false, pitches: [p] });
    return;
  }
  if (!ev.pitches.some((q) => q.drum === name)) ev.pitches = sortPitches([...ev.pitches, p]);
}

/** The General MIDI programs by LilyPond's names, in program order: what midiInstrument may say. */
export const PROGRAMS = [
  "acoustic grand", "bright acoustic", "electric grand", "honky-tonk", "electric piano 1",
  "electric piano 2", "harpsichord", "clav", "celesta", "glockenspiel", "music box", "vibraphone",
  "marimba", "xylophone", "tubular bells", "dulcimer", "drawbar organ", "percussive organ", "rock organ",
  "church organ", "reed organ", "accordion", "harmonica", "concertina", "acoustic guitar (nylon)",
  "acoustic guitar (steel)", "electric guitar (jazz)", "electric guitar (clean)",
  "electric guitar (muted)", "overdriven guitar", "distorted guitar", "guitar harmonics",
  "acoustic bass", "electric bass (finger)", "electric bass (pick)", "fretless bass", "slap bass 1",
  "slap bass 2", "synth bass 1", "synth bass 2", "violin", "viola", "cello", "contrabass",
  "tremolo strings", "pizzicato strings", "orchestral harp", "timpani", "string ensemble 1",
  "string ensemble 2", "synthstrings 1", "synthstrings 2", "choir aahs", "voice oohs", "synth voice",
  "orchestra hit", "trumpet", "trombone", "tuba", "muted trumpet", "french horn", "brass section",
  "synthbrass 1", "synthbrass 2", "soprano sax", "alto sax", "tenor sax", "baritone sax", "oboe",
  "english horn", "bassoon", "clarinet", "piccolo", "flute", "recorder", "pan flute", "blown bottle",
  "shakuhachi", "whistle", "ocarina", "lead 1 (square)", "lead 2 (sawtooth)", "lead 3 (calliope)",
  "lead 4 (chiff)", "lead 5 (charang)", "lead 6 (voice)", "lead 7 (fifths)", "lead 8 (bass+lead)",
  "pad 1 (new age)", "pad 2 (warm)", "pad 3 (polysynth)", "pad 4 (choir)", "pad 5 (bowed)",
  "pad 6 (metallic)", "pad 7 (halo)", "pad 8 (sweep)", "fx 1 (rain)", "fx 2 (soundtrack)",
  "fx 3 (crystal)", "fx 4 (atmosphere)", "fx 5 (brightness)", "fx 6 (goblins)", "fx 7 (echoes)",
  "fx 8 (sci-fi)", "sitar", "banjo", "shamisen", "koto", "kalimba", "bagpipe", "fiddle", "shanai",
  "tinkle bell", "agogo", "steel drums", "woodblock", "taiko drum", "melodic tom", "synth drum",
  "reverse cymbal", "guitar fret noise", "breath noise", "seashore", "bird tweet", "telephone ring",
  "helicopter", "applause", "gunshot",
];

/** A sound's General MIDI program; the piano for a name it does not know, as eui-score plays it. */
export function programOf(sound) {
  return Math.max(0, PROGRAMS.indexOf(sound || "acoustic grand"));
}

/** Which of INSTRUMENTS lane `s` is — its sound and, among those sharing it, its name — or -1. */
export function instrumentOf(score, s) {
  const staff = score.staves[upperOf(score, s)];
  if (staff.drums) return INSTRUMENTS.findIndex((it) => it.drums);
  const sound = staff.instrument || "acoustic grand";
  const same = INSTRUMENTS.map((it, k) => (it.sound === sound ? k : -1)).filter((k) => k >= 0);
  return same.find((k) => INSTRUMENTS[k].name === staff.name) ?? same[0] ?? -1;
}

/**
 * Lane `s` made instrument `k` of INSTRUMENTS: its sound, its clef (unless
 * the instrument keeps the staff's), and its names — unless the person named
 * the staff themselves, which an instrument's name never replaces.
 */
export function setInstrument(score, s, k) {
  const it = INSTRUMENTS[k];
  if (!it) throw new Error("no such instrument");
  const staff = score.staves[upperOf(score, s)];
  if (Boolean(it.drums) !== Boolean(staff.drums)) {
    throw new Error(it.drums ? "A staff of notes does not become a drum kit: add a drum staff with + Staff" : "A drum staff stays a drum staff: add a staff for this instrument with + Staff");
  }
  if (!staff.name || INSTRUMENTS.some((x) => x.name === staff.name)) {
    staff.name = it.name;
    staff.short = it.short;
  }
  staff.instrument = it.sound;
  if (it.clef) staff.clef = it.clef;
}

// ---- The page: paper, staff size, line and page breaks --------------------------------------
//
// What \\paper and #(set-global-staff-size …) say, kept as read and written
// back: `score.paper` {size, staffSize, left, right, top, bottom, indent} (mm,
// points), each null for LilyPond's default, and `evenPages`: true to spread
// the lines evenly over the pages, false to fill each in turn, null for the
// default (filled); `score.breaks` bar → "line" or
// "page", the break after that bar.

export const PAPER_SIZES = ["a4", "letter", "a3", "a5", "legal", "tabloid"];
const MARGINS = [["left", "left-margin"], ["right", "right-margin"], ["top", "top-margin"], ["bottom", "bottom-margin"], ["indent", "indent"]];

function paperFrom(p) {
  const out = { size: p?.size ?? null, staffSize: p?.staff_size ?? null };
  for (const [field] of MARGINS) out[field] = p?.[field] ?? null;
  out.evenPages = p?.even_pages ?? null;
  return out;
}

/** The paper (A4 by default, "letter", "a3landscape"…) and the staff size, in points (20 by default). */
export function setPaper(score, { size, staffSize }) {
  const name = String(size ?? "a4").toLowerCase();
  if (!PAPER_SIZES.includes(name.replace(/landscape$/, ""))) throw new Error(`no such paper: ${size}`);
  const pt = staffSize == null || staffSize === "" ? 20 : Number(staffSize);
  if (!(pt >= 11 && pt <= 26)) throw new Error("a staff size is 11 to 26 points");
  score.paper = { ...(score.paper ?? paperFrom(null)), size: name === "a4" ? null : name, staffSize: pt === 20 ? null : pt };
}

const PAPER_NAMES = { a4: "A4", letter: "Letter", a3: "A3", a5: "A5", a6: "A6", b4: "B4", b5: "B5", legal: "Legal", tabloid: "Tabloid", "11x17": "11×17" };

/**
 * The paper a source's PDF is printed on, as a menu names it: "A4" when its
 * \\paper sets none, "Letter", "A3 landscape"… Read from the text, so a
 * source the model cannot hold is named too. The read page's PDF button says
 * the same (ScoreSvg.paper_label, app/services/score_svg.sl).
 */
export function paperLabel(source) {
  const m = /set-paper-size\s+"([a-z0-9]+?)(landscape)?"(\s+'landscape)?/i.exec(String(source ?? ""));
  if (!m) return "A4";
  const name = PAPER_NAMES[m[1].toLowerCase()] ?? m[1];
  return m[2] || m[3] ? `${name} landscape` : name;
}

/**
 * An engraving cut for printing: one SVG per band of `svg`, cut across at
 * each y of `cuts` (in the drawing's own units), each a copy of the whole
 * drawing that shows only its band. Their ids are made their own, so no copy
 * points into another. The read page cuts the server's engraving the same
 * way (public/js/score.js, printBands): a change here goes there too.
 */
export function printBands(svg, cuts) {
  const head = /^<svg\b[^>]*>/.exec(svg ?? "");
  const box = head && /viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/.exec(head[0]);
  if (!box) return [svg ?? ""];
  const [x, y, w, h] = box.slice(1).map(Number);
  const inside = (cuts ?? []).filter((c) => c > y && c < y + h).sort((a, b) => a - b);
  const edges = [y, ...inside, y + h];
  const prefix = /<title id="([^"]+)-t"/.exec(svg)?.[1];
  const ids = prefix ? new RegExp(`(["#\\s])${prefix.replace(/[^\w]/g, "\\$&")}-`, "g") : null;
  const round = (n) => Math.round(n * 10) / 10;
  return edges.slice(1).map((end, k) => {
    const top = round(edges[k]);
    const tall = round(end - edges[k]);
    const own = head[0].replace(/viewBox="[^"]*"/, `viewBox="${x} ${top} ${w} ${tall}"`).replace(/\sheight="[^"]*"/, ` height="${tall}"`);
    const one = own + svg.slice(head[0].length);
    return ids ? one.replace(ids, `$1${prefix}-p${k}-`) : one;
  });
}

/** Whether the PDF spreads the lines evenly over its pages (true) or fills each in turn (false, the default). */
export function setEvenPages(score, even) {
  score.paper = { ...(score.paper ?? paperFrom(null)), evenPages: even ? true : null };
}

/** The break after bar `bar`: "line", "page", or none (null) — the line goes on. */
export function setBreak(score, bar, kind) {
  if (!Number.isInteger(bar) || bar < 0 || bar >= barsOf(score) - 1) throw new Error("a break goes after a bar, before the last one ends");
  if (kind != null && kind !== "line" && kind !== "page") throw new Error("a break is a line's or a page's");
  score.breaks = { ...(score.breaks ?? {}) };
  if (kind == null) delete score.breaks[bar];
  else score.breaks[bar] = kind;
}

/** What goes before the music: the staff size, then \\paper. */
function pageText(score) {
  const p = score.paper ?? {};
  const lines = [];
  if (p.staffSize && p.staffSize !== 20) lines.push(`#(set-global-staff-size ${p.staffSize})`);
  const inside = [];
  if (p.size && p.size !== "a4") inside.push(`#(set-paper-size ${quote(p.size)})`);
  for (const [field, name] of MARGINS) if (p[field] != null) inside.push(`${name} = ${p[field]}\\mm`);
  if (p.evenPages != null) inside.push(`page-breaking = #ly:${p.evenPages ? "optimal" : "minimal"}-breaking`);
  if (inside.length) lines.push(`\\paper { ${inside.join(" ")} }`);
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** A metre as \\time writes it: 3/4, or the score's added-up one, 2+3/8. */
export function timeText(score, time = score.time) {
  const parts = score.timeParts;
  const sum = parts?.reduce((a, b) => a + b, 0);
  if (parts && parts.length > 1 && sum === time[0] && time === score.time) return `${parts.join("+")}/${time[1]}`;
  return `${time[0]}/${time[1]}`;
}

/** A metre written "3/4" or "2+3/8": its [num, den], and its parts when added up (else null). */
export function metreOf(text) {
  const match = /^(\d+(?:\+\d+)*)\/(\d+)$/.exec(String(text).trim());
  if (!match) throw new Error("a metre is like 3/4, or 2+3/8");
  const parts = match[1].split("+").map(Number);
  return { time: [parts.reduce((a, b) => a + b, 0), Number(match[2])], parts: parts.length > 1 ? parts : null };
}

/** The score's metre from text: "3/4", or an added-up one, "2+3/8" (its parts kept). */
export function setMetre(score, text) {
  const { time, parts } = metreOf(text);
  setTime(score, time[0], time[1]);
  score.timeParts = parts;
}

// ---- Transposing instruments and parts ------------------------------------------------------
//
// A score keeps its notes as they sound (concert pitch): that is what is
// played, saved and edited. A clarinet in B♭, a horn in F, a saxophone read
// their parts written higher; the score shows them so on request (written
// pitch) and always in a part. Which way a staff is written follows from its
// instrument — its sound, and its name ("Clarinet in A", "Trumpet in C") —
// so the LilyPond text needs nothing more to say it.

/**
 * Where middle C of staff `staff`'s concert pitch is written, as LilyPond's
 * \transpose c <this> says it — "d" a tone higher (B♭), "g" a fifth (F) — or
 * null for a staff written as it sounds.
 */
export function transpositionOf(staff) {
  if (!staff || staff.drums) return null;
  const sound = staff.instrument || "";
  const name = staff.name || "";
  const key = /\bin\s+([A-G])\s*(♭|b|-flat)?\b/i.exec(name);
  const named = key ? key[1].toUpperCase() + (key[2] ? "♭" : "") : null;
  if (named === "C") return null;
  if (sound === "alto sax") return "a";
  if (sound === "baritone sax") return "a'";
  if (sound === "tenor sax") return "d'";
  if (sound === "soprano sax") return "d";
  if (sound === "english horn" || sound === "french horn") return named === "E♭" ? "a" : "g";
  if (sound === "clarinet") return named === "A" ? "ees" : named === "E♭" ? "a," : "d";
  if (sound === "trumpet") return named === "A" ? "ees" : named === "D" ? "bes," : named === "E♭" ? "a," : "d";
  return null;
}

/** The part of the staff on lane `s`: that staff (and its other voices) alone, its name on top. */
export function partOf(score, s) {
  const upper = upperOf(score, s);
  const lanes = voiceLanes(score, upper);
  const part = JSON.parse(JSON.stringify(score));
  const staff = part.staves[upper];
  part.staves = lanes.map((lane) => part.staves[lane]);
  part.groups = [];
  part.group = "none";
  part.header = { ...part.header, instrument: staff.name || INSTRUMENTS[instrumentOf(score, upper)]?.name || "" };
  // The staff's name is the part's heading: not repeated before each line.
  part.staves[0] = { ...part.staves[0], name: "", short: "" };
  // A player counts the bars it rests: they are gathered, R1*12 as one bar.
  part.compress = true;
  return part;
}

// ---- Playing ----------------------------------------------------------------------------------
//
// A repeat is played out: its bars twice, or once for each of its endings,
// each pass followed by its ending — as LilyPond's \unfoldRepeats does, the
// first ending standing in for the passes that have none. The MIDI is
// written from the score played out (`toLilyPond(score, { unfold: true })`),
// and `playback` says when each bar sounds on each pass.

/**
 * The bars in the order they sound, every repeat played out, and the jumps
 * taken: at a D.S. or a D.C. (once) the music goes back to the segno or the
 * start and plays on without its repeats, to the Fine, or from To Coda to
 * the coda.
 */
export function playOrder(score) {
  const order = repeatOrder(score);
  const jumps = (score.changes ?? []).filter((c) => JUMPS[c.jump]);
  const back = jumps.find((c) => /^(ds|dc)/.test(c.jump));
  if (!back) return order;
  const at = order.lastIndexOf(back.bar);
  const segno = (score.changes ?? []).find((c) => c.mark === "segno" && c.bar <= back.bar);
  const from = back.jump.startsWith("ds") ? segno?.bar ?? 0 : 0;
  const fine = jumps.find((c) => c.jump === "fine" && c.bar >= from)?.bar;
  const toCoda = jumps.find((c) => c.jump === "to-coda" && c.bar >= from)?.bar;
  const coda = (score.changes ?? []).find((c) => c.mark === "coda" && c.bar > back.bar)?.bar;
  const again = [];
  for (let b = from; b < barsOf(score); b++) {
    // The second time through, the repeats are not taken; an ending's
    // bars after the first are skipped with them.
    if ((score.repeats ?? []).some((r) => r.endings.length > 1 && b > r.to + r.endings[0] && b <= repeatEnd(r))) continue;
    again.push(b);
    if (back.jump.endsWith("fine") && b === fine) break;
    if (back.jump.endsWith("coda") && b === toCoda && coda != null) {
      for (let c = coda; c < barsOf(score); c++) again.push(c);
      break;
    }
  }
  // Before the D.S., a coda is not played: the music jumps over it.
  const first = order.slice(0, at + 1).filter((b) => coda == null || b < coda || !back.jump.endsWith("coda"));
  return [...first, ...again];
}

/**
 * The LilyPond a MIDI file is written from: `source` with every repeat
 * played out and its D.S. and D.C. taken, when this model reads it —
 * `parse` is eui-score's `score_json`. A source with neither, or one the
 * model cannot read, is played as it is written: the engraver's own MIDI
 * plays a repeat once, then each of its endings.
 */
export function playedSource(source, parse) {
  if (!/\\(repeat|jump)\b/.test(source)) return source;
  let read;
  try {
    read = fromParsed(JSON.parse(parse(source)));
  } catch {
    return source;
  }
  return read.score ? toLilyPond(read.score, { unfold: true }).source : source;
}

/** The bars in the order they sound, every repeat played out. */
function repeatOrder(score) {
  const total = barsOf(score);
  const order = [];
  const span = (from, n) => Array.from({ length: n }, (_, k) => from + k);
  let b = 0;
  while (b < total) {
    const r = (score.repeats ?? []).find((x) => x.from === b);
    if (!r) {
      order.push(b++);
      continue;
    }
    const passes = Math.max(r.times ?? 2, r.endings.length);
    const starts = [];
    let next = r.to + 1;
    for (const n of r.endings) {
      starts.push(next);
      next += n;
    }
    for (let pass = 0; pass < passes; pass++) {
      order.push(...span(r.from, r.to + 1 - r.from));
      if (!r.endings.length) continue;
      const e = Math.max(0, pass - (passes - r.endings.length));
      order.push(...span(starts[e], r.endings[e]));
    }
    b = next;
  }
  return order;
}

/** The beat and its speed in bar `b`, as secondsAt counts them: 100 a quarter when none is set. */
function speedAt(score, b) {
  let bpm = score.tempo?.bpm || DEFAULT_BPM;
  let base = score.tempo?.base || 4;
  for (const c of score.changes ?? []) {
    if (c.bar > b || !c.tempo?.bpm) continue;
    bpm = c.tempo.bpm;
    base = c.tempo.base || base;
  }
  return { bpm, base };
}

/**
 * Where bar `b`'s fermatas hold, as eui-score's MIDI holds them: the music
 * waits, when a note under a fermata ends, as long again as that note —
 * the longest, when several end together. [{ at, ticks }]: `at` ticks into
 * the bar.
 */
function holdsIn(score, b) {
  const from = barStart(score, b);
  const to = from + barLength(score, b);
  const byEnd = new Map();
  for (const staff of score.staves) {
    const at = starts(staff);
    staff.events.forEach((ev, k) => {
      if (ev.rest || !ev.arts.includes("fermata") || at[k] < from || at[k] >= to) return;
      const ticks = ticksOf(ev);
      const end = at[k] + ticks - from;
      byEnd.set(end, Math.max(byEnd.get(end) ?? 0, ticks));
    });
  }
  return [...byEnd].map(([at, ticks]) => ({ at, ticks })).sort((x, y) => x.at - y.at);
}

/** Seconds from a pass's start to `into` ticks into its bar, the fermatas before it held. */
function intoPass(p, into) {
  if (p.curve) {
    // A glide through the bar: each fermata held at the speed where it is.
    const held = p.holds.filter((h) => h.at <= into).reduce((sum, h) => sum + holdSeconds(p, h), 0);
    return curveTime(p.curve, 0, into) + held;
  }
  const held = p.holds.filter((h) => h.at <= into).reduce((sum, h) => sum + h.ticks, 0);
  return ((into + held) / M_TICKS(p.base)) * (60 / p.bpm);
}

/** A fermata's hold in pass `p`, in seconds: at the speed where it is held. */
const holdSeconds = (p, h) => (p.curve ? (h.ticks * 240) / WHOLE / curveSpeed(p.curve, h.at) : (h.ticks / M_TICKS(p.base)) * (60 / p.bpm));

/** Pass `p`'s length as played, in ticks: its bar's, and its fermatas' holds — as the MIDI file has it. */
export function passTicks(score, p) {
  return barLength(score, p.bar) + p.holds.reduce((sum, h) => sum + h.ticks, 0);
}

/**
 * Seconds from pass `p`'s start to `u` ticks into it as played: a fermata's
 * hold counted where the MIDI holds it, after the held note's written end.
 */
export function passSeconds(p, u) {
  let held = 0;
  for (const h of [...p.holds].sort((a, b) => a.at - b.at)) {
    const from = h.at + held;
    if (u < from) break;
    if (u < from + h.ticks) return intoPass(p, h.at) - holdSeconds(p, h) + ((u - from) / h.ticks) * holdSeconds(p, h);
    held += h.ticks;
  }
  return intoPass(p, u - held);
}

/** A gliding bar's clock line: [{ sec, q }] every sixteenth, `q` the quarters into it. */
function stepsOf(p, length) {
  const out = [];
  for (let x = 0; ; x = Math.min(length, x + WHOLE / 16)) {
    out.push({ sec: p.start + intoPass(p, x), q: x / (WHOLE / 4) });
    if (x >= length) return out;
  }
}

/** Every pass through a bar, in the order they sound: [{ bar, start, end, bpm, base, holds }], in seconds. */
export function playback(score) {
  let sec = 0;
  // A rit. or an accel. on the way: the bars it touches glide (`curve`), and give their clock's steps.
  const ramps = tempoRamps(score);
  const curves = new Map();
  return playOrder(score).map((bar) => {
    const { bpm, base } = speedAt(score, bar);
    const start = sec;
    const pass = { bar, start, end: 0, bpm, base, holds: holdsIn(score, bar) };
    if (ramps.length) {
      if (!curves.has(bar)) curves.set(bar, curveOf(score, ramps, bar));
      if (curves.get(bar)) pass.curve = curves.get(bar);
    }
    const length = barLength(score, bar);
    sec += intoPass(pass, length);
    pass.end = sec;
    if (pass.curve) pass.steps = stepsOf(pass, length);
    return pass;
  });
}

/** When time `t` (ticks) sounds, in seconds, on each pass through its bar. */
export function playedAt(score, passes, t) {
  const bar = barAt(score, t);
  const into = t - barStart(score, bar);
  return passes.filter((p) => p.bar === bar).map((p) => p.start + intoPass(p, into));
}

/**
 * When lane `s`'s note `i` (starting at `t`, ticks) is heard, on each pass
 * through its bar: after its grace notes, which take their time from it —
 * as long as they are written, half the note at most, as eui-score plays them.
 */
export function heardAt(score, passes, s, i, t = starts(score.staves[s])[i]) {
  const ev = score.staves[s].events[i];
  const graces = (ev.graces ?? []).reduce((sum, g) => sum + notated(g.base, g.dots), 0);
  const stolen = graces > 0 ? Math.max(1, Math.min(graces, Math.floor(ticksOf(ev) / 2))) : 0;
  return playedAt(score, passes, t).map((sec, k) => {
    const p = passes.filter((x) => x.bar === barAt(score, t))[k];
    return sec + (stolen / M_TICKS(p.base)) * (60 / p.bpm);
  });
}

/** The pass sounding at `sec`, or the last one when the music is over; null for an empty score. */
export function passAt(passes, sec) {
  let k = 0;
  while (k + 1 < passes.length && passes[k + 1].start <= sec + 1e-6) k++;
  return passes[k] ?? null;
}

/**
 * The time (ticks) sounding at `sec` of the playback `passes`: the bar of the
 * pass then sounding, so far through it as that pass is — a repeat played
 * again gives its bars again.
 */
export function tickAtPlayed(score, passes, sec) {
  const p = passAt(passes, sec);
  if (!p) return 0;
  const length = barLength(score, p.bar);
  let into = p.end > p.start ? ((sec - p.start) / (p.end - p.start)) * length : 0;
  if (p.curve) {
    // A gliding bar: where its time reaches `sec`.
    let [lo, hi] = [0, length];
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (p.start + intoPass(p, mid) < sec) lo = mid;
      else hi = mid;
    }
    into = lo;
  }
  return barStart(score, p.bar) + Math.max(0, Math.min(length, into));
}

/**
 * The metronome's beats, every repeat played out: [{ sec, down }], `down`
 * on each bar's first. `subdivide` (8 or 16) adds the eighths or sixteenths
 * between the beats, as { sec, down: false, sub: true }, where they are
 * shorter than the beat.
 */
export function beats(score, passes, { subdivide = 0 } = {}) {
  const out = [];
  for (const p of passes) {
    const [num, den] = timeAt(score, p.bar);
    // A pickup is the end of a bar: its beats are the bar's last ones.
    const missing = (WHOLE * num) / den - barLength(score, p.bar);
    const parts = subdivide > den && subdivide % den === 0 ? subdivide / den : 1;
    for (let k = 0; k < num; k++) {
      for (let j = 0; j < parts; j++) {
        const into = (k * WHOLE) / den + (j * WHOLE) / (den * parts) - missing;
        if (into < 0) continue;
        const sec = p.start + intoPass(p, into);
        out.push(j ? { sec, down: false, sub: true } : { sec, down: k === 0 });
      }
    }
  }
  return out;
}

// ---- MIDI channels (#389) -------------------------------------------------------------
//
// eui-score numbers a staff's channel by its place (the tenth skipped, kept
// for the drums) and stops at the sixteenth: past fifteen staves, the last
// ones play on one channel, in the instrument of the last heard. `channels`
// plans them so that they do not: as eui-score numbers them when nothing
// collides; else each pitched staff a channel of its own while fifteen are
// enough; else staves of the same instrument and the same mixer settings
// (and no curves of their own) sharing one, and past fifteen of those a
// second MIDI port (a third…), sixteen channels more each, the drums' tenth
// left out there too. `channel` is the synthesizer's: port × 16 + the
// channel written in the file. channels.js rewrites the engraver's MIDI so.

/** The channels a port gives pitched staves: all but the drums' tenth. */
export const PITCHED_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/** The channel eui-score itself gives the `k`th staff. */
export function engineChannel(drums, k) {
  return drums ? 9 : k < 9 ? k : Math.min(15, k + 1);
}

/** A value as text, its keys sorted: two settings alike read alike. */
const canonical = (x) =>
  Array.isArray(x)
    ? `[${x.map(canonical).join(",")}]`
    : x && typeof x === "object"
      ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}`
      : JSON.stringify(x ?? null);

/** What two pitched staves must have alike to share a channel: the instrument, the mixer's settings, and no curves. */
function sharingKey(score, lane) {
  const curves = score.meta?.cc?.[lane];
  if (curves && Object.keys(curves).length) return `lane ${lane}`;
  return `${score.staves[lane].instrument ?? ""}|${canonical(score.meta?.mixer?.tracks?.[lane] ?? {})}`;
}

/** The synthesizer channel of the `n`th pitched slot: port after port, the tenth left out. */
const slot = (n) => 16 * Math.floor(n / 15) + PITCHED_CHANNELS[n % 15];

/**
 * Each staff and its MIDI channel: [{ lane, name, channel, port }] — `port`
 * the file's MIDI port, `channel` the synthesizer's (port × 16 + the file's).
 * The staff `padded` adds never moves the others: it takes a channel of its
 * own after them.
 */
export function channels(score) {
  const rows = staffLanes(score).map((lane, k) => ({ lane, name: score.staves[lane].name || `Staff ${k + 1}`, channel: engineChannel(score.staves[lane].drums, k) }));
  const real = rows.filter((r) => !score.staves[r.lane].padding);
  const pitched = real.filter((r) => !score.staves[r.lane].drums);
  if (new Set(pitched.map((r) => r.channel)).size !== pitched.length) {
    if (pitched.length <= PITCHED_CHANNELS.length) pitched.forEach((r, n) => (r.channel = slot(n)));
    else {
      const groups = new Map();
      for (const r of pitched) {
        const key = sharingKey(score, r.lane);
        if (!groups.has(key)) groups.set(key, slot(groups.size));
        r.channel = groups.get(key);
      }
    }
  }
  const used = new Set(real.map((r) => r.channel));
  for (const r of rows) {
    if (!score.staves[r.lane].padding) continue;
    if (used.has(r.channel)) {
      let n = 0;
      while (used.has(slot(n))) n++;
      r.channel = slot(n);
    }
    used.add(r.channel);
  }
  return rows.map((r) => ({ ...r, port: Math.floor(r.channel / 16) }));
}

/** A lane's bars in the order they sound; a jump back says again the metre and the speed it returns to. */
function playedOut(score, s, bars) {
  const first = staffNumber(score, s) === 0;
  let previous = -1;
  return playOrder(score)
    .map((b) => {
      let jump = "";
      if (previous >= 0 && b !== previous + 1) {
        const [was, now] = [timeAt(score, previous), timeAt(score, b)];
        if (was[0] !== now[0] || was[1] !== now[1]) jump += `\\time ${now[0]}/${now[1]} `;
        const [before, after] = [speedAt(score, previous), speedAt(score, b)];
        if (first && (before.bpm !== after.bpm || before.base !== after.base)) jump += `\\tempo ${after.base} = ${after.bpm} `;
      }
      previous = b;
      return jump + bars[b];
    })
    .join(" | ");
}

// ---- Reading eui-score's parse back ---------------------------------------------------------

/** What the editor says of a piece of several movements (#359): engraved, edited in the text. */
const MOVEMENTS = "several movements (one \\score after another): edit them one at a time in the text";
/** The parse's breath marks, by their glyph, as the model names them. */
const BREATHS_READ = { breathMarkComma: "breathe", caesura: "caesura" };

/**
 * What the engraver's warnings (Parsed.warnings) name as passed over — a
 * layout setting (`\\override Stem.direction`), a `\\layout` block, a header
 * field no title prints — each once: what a rewrite leaves out. A movement
 * the engraver could not set is not a setting (see MOVEMENTS).
 */
export function passedOver(warnings) {
  const names = new Set();
  for (const w of warnings ?? []) {
    if (/^movement \d|^the lyrics of movement/.test(w)) continue;
    names.add(w.replace(/:.*$/, "").replace(/ (is|are) not (drawn|read|engraved|set|words this prints).*$/, "").replace(/ outside the music$/, "").trim());
  }
  const list = [...names].filter(Boolean);
  return list.length > 6 ? [...list.slice(0, 5), `${list.length - 5} more`] : list;
}

const CLEF_NAMES = { "G,-2,0": "treble", "G,-2,-1": "treble_8", "F,2,0": "bass", "F,2,-1": "bass_8", "C,0,0": "alto", "C,2,0": "tenor", "C,-4,0": "soprano" };

/**
 * A score from `score_json`'s answer, or `{ unsupported: [...] }` naming
 * what it uses that this model does not keep — so the page edits the text
 * instead of losing it.
 */
export function fromParsed(parsed) {
  const unsupported = new Set();
  // What the model reads and does not keep: the first edit writes the text without it.
  const lost = new Set();
  // The layout settings the engraver passes over (\\override, \\set, \\with …): not written again.
  const settings = passedOver(parsed.warnings);
  if (settings.length) lost.add(`the settings the engraver passes over (${settings.join(", ")})`);
  if ((parsed.warnings ?? []).some((w) => /^movement \d/.test(w))) unsupported.add(MOVEMENTS);
  const score = { header: { ...parsed.header }, key: 0, time: [4, 4], tempo: null, group: "none", groups: [], staves: [], repeats: [], changes: [] };
  score.paper = paperFrom(parsed.paper);
  score.breaks = {};
  // Where the first staff's repeat signs fall, in bars: the score's repeats.
  const signs = [];
  const kinds = { Brace: "brace", Bracket: "bracket", Choir: "choir" };
  // The group around every staff is the score's; the others are kept as they nest.
  const outer = parsed.groups.find((g) => g.depth === 0 && g.first === 0 && g.last === parsed.staves.length - 1);
  if (outer) score.group = kinds[outer.kind] ?? "none";
  score.groups = parsed.groups
    .filter((g) => g !== outer && kinds[g.kind])
    .map((g) => ({ kind: kinds[g.kind], first: g.first, last: g.last, name: g.name ?? "", short: g.short ?? "" }));
  let first = true;
  for (const staff of parsed.staves) {
    const drums = staff.kind === "Drums";
    const kinds = { Tab: "tablature", ChordNames: "chord-name staves", Figures: "a figured bass", FretBoards: "guitar chord diagrams", Ossia: "an ossia" };
    if (staff.kind !== "Notes" && !drums) unsupported.add(kinds[staff.kind] ?? "a staff of another kind");
    const out = { name: staff.name ?? "", short: staff.short ?? "", instrument: drums ? "" : staff.instrument ?? "", clef: drums ? "percussion" : "treble", events: [] };
    if (drums) out.drums = true;
    // Voices 2 to 4, `<< { … } \\ { … } \\ { … } >>`: each its own lane, rests where it is silent.
    const others = [2, 3, 4].map((voice) => ({ voice, events: [] }));
    // Which voice a part is: the one the engraver gave it (\voiceThree…), else counted.
    const laneFor = (voice) => (voice >= 2 ? others[voice - 2] : out);
    let lane = out;
    let voices = 0;
    const pad = (target, upto) => target.events.push(...rests(score, lengthOf(target), upto - lengthOf(target)));
    let started = false;
    const tuplets = new Map();
    let key = null;
    let mode = null;
    let time = null;
    // The score's keys changed inside bars this staff changed with.
    let midKeysSeen = 0;
    // An \ottava waiting for its lane's next note or rest.
    const ottavas = new Map();
    // Each lane's stems and beaming, as its notes last said.
    const switches = new Map();
    for (const ev of staff.events) {
      ev.unsupported.forEach((u) => unsupported.add(u));
      // A tuplet in a tuplet is engraved and played; the score tools write one level.
      if (ev.tuplet_outer) unsupported.add("a tuplet inside a tuplet");
      // Engraved and played; the score tools write each voice on its own staff.
      if (ev.cross) unsupported.add("notes moved to another staff");
      const k = ev.k;
      // A change after the first note is the bar's it starts: the first staff
      // writes the score's changes, the others must change with it.
      const here = lengthOf(lane);
      const bar = isBarLine(score, here) ? barAt(score, here) : -1;
      // A \\break or \\pageBreak: the first staff's say where lines and pages end.
      if (k === "Break") {
        if (first && bar > 0) score.breaks[bar - 1] = ev.page ? "page" : "line";
        continue;
      }
      if (k === "Ottava") {
        ottavas.set(lane, ev.ottava);
        continue;
      }
      if (k === "Movement") {
        unsupported.add(MOVEMENTS);
        continue;
      }
      if (k === "Clef" && drums) continue;
      if (k === "Clef") {
        const name = CLEF_NAMES[ev.clef.join(",")];
        if (!name) unsupported.add("this clef");
        if (!started || bar === 0) out.clef = name ?? "treble";
        else if (bar < 0) {
          // Inside a bar: from the next note or rest on (#360).
          const b = barAt(score, here);
          out.midClefs = [...(out.midClefs ?? []), { bar: b, pos: here - barStart(score, b), clef: name ?? "treble" }];
        } else {
          out.clefs = [...(out.clefs ?? []).filter((c) => c.bar !== bar), { bar, clef: name ?? "treble" }];
        }
      } else if (k === "Key") {
        const named = ev.mode && ev.mode !== "major" && MODES[ev.mode] != null ? ev.mode : null;
        if (!started) {
          key = ev.fifths;
          mode = named;
        } else if (bar < 0) {
          // Inside a bar: the first staff's is the score's; the others change with it.
          const b = barAt(score, here);
          const pos = here - barStart(score, b);
          if (first) score.midKeys = [...(score.midKeys ?? []), { bar: b, pos, key: ev.fifths, ...(named ? { mode: named } : {}) }];
          else if (!drums && ++midKeysSeen && !(score.midKeys ?? []).some((m) => m.bar === b && Math.abs(m.pos - pos) < 1e-6 && Math.max(-7, Math.min(7, m.key + (out.key ?? score.key) - score.key)) === ev.fifths)) unsupported.add("staves changing key apart");
        } else if (first) {
          const same = ev.fifths === scoreKeyAt(score, bar - 1, Infinity) && (named ?? "major") === modeAt(score, bar - 1, Infinity);
          setChange(score, bar, "key", same ? null : ev.fifths);
          setChange(score, bar, "mode", same ? null : named);
        }
        else if (!drums && ev.fifths !== Math.max(-7, Math.min(7, scoreKeyAt(score, bar) + (out.key ?? score.key) - score.key))) unsupported.add("staves changing key apart");
      } else if (k === "Time") {
        const added = (ev.time_parts ?? []).filter((p) => p > 0);
        if (!started) {
          time = ev.time;
          // An additive metre at the start, 2+3/8: its parts, to be written again.
          if (first) score.timeParts = added.length > 1 ? added : null;
        } else if (added.length > 1) unsupported.add("an added-up metre after the start");
        else if (bar < 0) unsupported.add("a change of metre inside a bar");
        else if (first) {
          const was = timeAt(score, bar);
          if (bar > 0 && (ev.time[0] !== was[0] || ev.time[1] !== was[1])) setChange(score, bar, "time", ev.time);
        } else {
          const want = timeAt(score, bar);
          if (ev.time[0] !== want[0] || ev.time[1] !== want[1]) unsupported.add("staves changing metre apart");
        }
      } else if (k === "Tempo") {
        if (!started) {
          if (first) score.tempo = ev.tempo;
        } else if (bar < 0) unsupported.add("a change of tempo inside a bar");
        else if (first) {
          if (bar === 0) score.tempo = ev.tempo;
          else setChange(score, bar, "tempo", { text: ev.tempo.text ?? "", base: ev.tempo.base || 4, bpm: ev.tempo.bpm || 0 });
        }
      } else if (k === "Partial") {
        // A pickup: the first staff's is the score's, the others' the same.
        if (started) unsupported.add("a pickup after the first note");
        else if (first) score.pickup = ev.ticks;
        else if (ev.ticks !== (score.pickup ?? 0)) unsupported.add("staves whose pickups differ");
      } else if (k === "Mark") {
        // A mark over a bar line: a jump over the end of the bar before it
        // (or of the last bar), else the bar's own mark.
        if (!first) continue;
        if (bar < 0) {
          unsupported.add("a mark inside a bar");
          continue;
        }
        const jump = Object.keys(JUMPS).find((id) => JUMPS[id] === ev.mark?.text);
        const own = ev.mark?.glyph === "segno" ? "segno" : ev.mark?.glyph === "coda" ? "coda" : /^[A-Z]{1,2}$/.test(ev.mark?.text ?? "") ? "letter" : null;
        if (jump && bar > 0) setChange(score, bar - 1, "jump", jump);
        else if (own) setChange(score, bar, "mark", own);
        else unsupported.add("a mark this editor does not name");
      } else if (k === "Compress") {
        // \\compressMMRests (or \\compressEmptyMeasures, skipBars): bars of rest gathered.
        score.compress = true;
      } else if (k === "Voices") {
        if (voices) unsupported.add("voices inside voices");
        voices = 1;
        for (const other of others) pad(other, lengthOf(out));
      } else if (k === "VoiceNext") {
        voices++;
        lane = laneFor(voices);
      } else if (k === "VoicesEnd") {
        voices = 0;
        lane = out;
        const upto = Math.max(lengthOf(out), ...others.map(lengthOf));
        pad(out, upto);
        for (const other of others) pad(other, upto);
      } else if (["RepeatStart", "RepeatEnd", "VoltaStart", "VoltaEnd", "Bar"].includes(k)) {
        // Repeat signs, where they fall in bars — the first staff's are the score's.
        if (!first) continue;
        const at = bar >= 0 ? bar : barAt(score, here) + 0.5;
        const marks = { RepeatStart: ["start"], RepeatEnd: ["end"], VoltaStart: ["volta"], VoltaEnd: ["volta-end"], Bar: { ".|:": ["start"], ":|.": ["end"], ":|.|:": ["end", "start"] }[ev.bar] ?? [] }[k];
        if (marks.length && !Number.isInteger(at)) unsupported.add("a repeat inside a bar");
        // A double bar line between sections (or a final one, before a coda): the bar after it keeps it.
        if (k === "Bar" && ["||", "|."].includes(ev.bar)) {
          if (bar > 0) setChange(score, bar, "line", ev.bar);
          else if (bar < 0) lost.add("a double bar line inside a bar");
        }
        for (const mark of marks) signs.push({ mark, at, times: ev.times ?? null });
      } else if (k === "Note" || k === "Rest") {
        if (!started) {
          started = true;
          if (first) {
            score.key = key ?? 0;
            if (mode) score.mode = mode;
            score.time = time ?? [4, 4];
          } else {
            // A staff in a key of its own (a horn in E♭), or a metre of its own
            // whose bars last as long as the others' (6/8 beside 3/4).
            if ((key ?? 0) !== score.key && !drums) out.key = key ?? 0;
            const own = time ?? [4, 4];
            if (own[0] !== score.time[0] || own[1] !== score.time[1]) {
              if (own[0] * score.time[1] !== score.time[0] * own[1]) unsupported.add("staves whose bars last differently");
              else out.time = own;
            }
          }
        }
        // In voices, the voice the engraver numbered: \voiceThree alone beside voice 1 is voice 3.
        if (voices && ev.voice >= 1 && ev.voice <= 4 && laneFor(ev.voice) !== lane) {
          const own = laneFor(ev.voice);
          if (ottavas.has(lane)) ottavas.set(own, ottavas.get(lane));
          ottavas.delete(lane);
          lane = own;
        }
        const ottava = ottavas.get(lane);
        ottavas.delete(lane);
        if (k === "Rest" && ev.full) {
          const whole = rests(score, lengthOf(lane), ev.ticks * Math.max(1, ev.count));
          if (ottava != null && whole.length) whole[0].ottava = ottava;
          // A breath or a text span on a bar's rest: on its first rest, or its last.
          if (whole.length && ev.span_start != null) whole[0].spanStart = ev.span_start;
          if (whole.length && ev.span_stop) whole[whole.length - 1].spanEnd = true;
          if (whole.length && BREATHS_READ[ev.breath]) whole[whole.length - 1].breath = BREATHS_READ[ev.breath];
          lane.events.push(...whole);
          continue;
        }
        let tuplet = null;
        if (ev.tuplet) {
          const [tid, n, d] = ev.tuplet;
          if (!tuplets.has(tid)) tuplets.set(tid, newId());
          tuplet = { id: tuplets.get(tid), n, d };
        }
        const texts = ev.texts.map(([text, dir, italic, bold]) => ({ text, dir, ...(italic ? { italic: true } : {}), ...(bold ? { bold: true } : {}) }));
        // A short word above a note that reads as a chord is its chord symbol.
        const chordAt = texts.findIndex((w) => w.dir < 0 && !w.bold && isChordSymbol(w.text));
        const chord = chordAt >= 0 ? texts.splice(chordAt, 1)[0].text : ev.chord_name || "";
        // An open or a stopped hi-hat's sign comes with its drum.
        const scripts = drums ? ev.scripts.filter(([name]) => !["open", "stopped"].includes(name)) : ev.scripts;
        const arts = scripts.map(([name]) => name).filter((n) => SCRIPTS[n]);
        if (scripts.some(([name]) => !SCRIPTS[name])) unsupported.add("some articulations");
        const byKey = (key) => (DRUMS.find((x) => x.key === key) ?? MORE_DRUMS.find((x) => x.key === key))?.name;
        if (drums && ev.drums.some(([, key]) => !byKey(key))) unsupported.add("a drum this editor does not name");
        const read = makeEvent({
          rest: k === "Rest",
          pitches: drums ? ev.drums.map(([, key]) => drumPitch(byKey(key) ?? "sn")) : ev.pitches.map(([d, alter]) => ({ d, alter })),
          base: ev.base, dots: ev.dots, tuplet,
          tie: ev.tie, slurStart: ev.slur_on, slurEnd: ev.slur_off, dynamic: ev.dynamic ?? null,
          hairpin: ev.hairpin ?? null, hairpinEnd: ev.hairpin_end, arts, chord, texts,
          graces: (ev.graces ?? []).map(([pitches, base, dots]) => ({ pitches: pitches.map(([d, alter]) => ({ d, alter })), base, dots })),
          grace: ev.grace ?? null, arpeggio: Boolean(ev.arpeggio), gliss: Boolean(ev.gliss), tremolo: ev.tremolo ?? 0,
          pedalOn: Boolean(ev.pedal_on), pedalOff: Boolean(ev.pedal_off),
          // A spacer, `s`: takes its time, drawn as nothing. Beams written by hand.
          ...(k === "Rest" && ev.spacer ? { spacer: true } : {}),
          ...(ev.beam_on ? { beamStart: true } : {}),
          ...(ev.beam_off ? { beamEnd: true } : {}),
          ...(ottava != null ? { ottava } : {}),
          // Fingerings and string numbers (see setFingering); phrasing slurs.
          ...(!drums && ev.fingers?.length ? { fingers: ev.fingers.map(([text, dir, head, circled]) => ({ text, dir, head: head ?? null, circled })) } : {}),
          ...(ev.phrase_on ? { phraseStart: true } : {}),
          ...(ev.phrase_off ? { phraseEnd: true } : {}),
          // Real files (#359): cis! and cis?, a crescendo in words, a tie let ring or repeated, a text span, a breath.
          ...(!drums && k === "Note" && ev.forced?.length ? { forced: [...ev.forced] } : {}),
          ...(!drums && k === "Note" && ev.cautionary?.length ? { cautionary: [...ev.cautionary] } : {}),
          ...(ev.hairpin && HAIRPIN_WORDS.includes(String(ev.hairpin_text ?? "").replace(/\.$/, "")) ? { hairpinWords: ev.hairpin_text.replace(/\.$/, "") } : {}),
          ...(k === "Note" && ev.lv ? { lv: true } : {}),
          ...(k === "Note" && ev.repeat_tie ? { repeatTie: true } : {}),
          ...(ev.span_start != null ? { spanStart: ev.span_start } : {}),
          ...(ev.span_stop ? { spanEnd: true } : {}),
          ...(BREATHS_READ[ev.breath] ? { breath: BREATHS_READ[ev.breath] } : {}),
        });
        // \\stemUp and \\autoBeamOff hold until changed: written where the lane's notes change them.
        if (k === "Note") {
          const was = switches.get(lane) ?? { stem: 0, beam: false };
          if ((ev.stem ?? 0) !== was.stem) read.stemDir = ev.stem ?? 0;
          if (Boolean(ev.no_autobeam) !== was.beam) read.noAutoBeam = Boolean(ev.no_autobeam);
          switches.set(lane, { stem: ev.stem ?? 0, beam: Boolean(ev.no_autobeam) });
        }
        // A note past its bar line, as the engraver cuts it: tied pieces.
        const at = lengthOf(lane);
        if (!tuplet && at + ev.ticks > nextBarLine(score, at) + 1e-6) lane.events.push(...pieces(score, read, at, ev.ticks, "whole"));
        else lane.events.push(read);
      }
    }
    // A staff that did not change key inside a bar where the first did.
    if (!first && !drums && midKeysSeen !== (score.midKeys ?? []).length) unsupported.add("staves changing key apart");
    // An \ottava with no note after it draws nothing.
    if (ottavas.size) lost.add("an \\ottava after the last note");
    if (staff.lyrics) {
      if (staff.lyrics_voice !== 1) unsupported.add("lyrics to a second voice");
      const skip = melismata(out);
      [staff.lyrics, ...(staff.verses ?? [])].forEach((words, v) => {
        let k = 0;
        out.events.forEach((ev, i) => {
          if (skip[i]) return;
          const syl = words[k++];
          if (syl && syl.text && syl.text !== "_") putSyllable(ev, v + 1, { text: syl.text, hyphen: syl.hyphen, extend: syl.extend });
        });
      });
    }
    score.staves.push(out);
    // The voices up to the last that sounds: one before it that is silent stays, as rests.
    let kept = others.length;
    while (kept > 0 && !(others[kept - 1].events.length && sounding(others[kept - 1].events))) kept--;
    for (const other of others.slice(0, kept)) {
      pad(other, lengthOf(out));
      score.staves.push(other);
    }
    first = false;
  }
  if (signs.length) {
    const repeats = repeatsFrom(signs);
    if (repeats) score.repeats = repeats;
    else unsupported.add("repeats this editor cannot follow");
  }
  if (unsupported.size) return { unsupported: [...unsupported] };
  if (!score.staves.length) return { unsupported: ["a piece with no staff"] };
  ensureLength(score, Math.max(...score.staves.map(lengthOf), barStart(score, 1)));
  if (score.staves.some((st) => !isBarLine(score, lengthOf(st)))) return { unsupported: ["a bar left unfinished"] };
  // A double bar at the very end is the final bar line, written anyway.
  score.changes = score.changes.filter((c) => c.bar < barsOf(score));
  // A beam written by hand that does not close in its bar is not written again.
  for (const staff of score.staves) {
    const kept = handBeams(score, staff).filter((b) => b === "[").length;
    if (kept < staff.events.filter((ev) => ev.beamStart).length) lost.add("a beam across a bar line, or around a rest or a longer note");
  }
  return lost.size ? { score, lost: [...lost] } : { score };
}

// ---- Tempo ramps: rit., rall., accel. played ---------------------------------------------
//
// A rit., a rall. or an accel. — a `\tempo "rit."`, the words over a note
// (`^\markup "accel."`), or a text spanner's (`\startTextSpan`, its left text
// "rit.") — makes the speed glide, from where it stands, to the next tempo
// indication: to its speed when it gives one (`\tempo 4 = 60`), else by
// RAMP_FACTOR. A spanner glides to its end. The words with a speed
// (`\tempo "rit." 4 = 60`) glide to that speed. "a tempo" or "Tempo I" go
// back to the speed before; a glide that ends otherwise holds its speed.

const SLOWER = /\b(rit|ritard|ritardando|rall|rallentando|allarg|allargando|calando|slentando)\b/i;
const FASTER = /\b(accel|accelerando|stringendo|string\.|incalzando)/i;
const BACK = /\b(a\s+tempo|tempo\s+(i|1|primo))\b/i;

/** How far a glide with no speed to reach goes: three quarters as fast, or a quarter faster. */
export const RAMP_FACTOR = { slower: 0.75, faster: 1.25 };

/** "slower", "faster", or null: which way words such as "poco rit." make the speed go. */
export function rampOf(text) {
  if (!text || BACK.test(text)) return null;
  if (SLOWER.test(text)) return "slower";
  if (FASTER.test(text)) return "faster";
  return null;
}

/** A tempo as quarters a minute. */
const qpmOf = ({ bpm, base }) => (bpm * 4) / (base || 4);

/**
 * The stretches where the speed is not the bars' own, in written ticks:
 * [{ t0, t1, q0, q1 }], the speed (quarters a minute) gliding from q0 to q1
 * — the same, for a speed a glide left behind.
 */
export function tempoRamps(score) {
  const end = Math.max(0, ...score.staves.map(lengthOf));
  const begins = [];
  const stops = [];
  for (const c of score.changes ?? []) {
    if (!c.tempo) continue;
    const t = barStart(score, c.bar);
    const way = rampOf(c.tempo.text);
    if (way) begins.push({ t, way, target: c.tempo.bpm ? qpmOf(c.tempo) : null, before: Math.max(0, c.bar - 1) });
    else stops.push({ t, qpm: c.tempo.bpm ? qpmOf(c.tempo) : null, back: BACK.test(c.tempo.text ?? "") || Boolean(c.tempo.bpm) });
  }
  for (const staff of score.staves) {
    const at = starts(staff);
    staff.events.forEach((ev, i) => {
      for (const words of ev.texts ?? []) {
        const way = rampOf(words.text);
        if (way) begins.push({ t: at[i], way, target: null });
        else if (BACK.test(words.text)) stops.push({ t: at[i], qpm: null, back: true });
      }
      const way = ev.spanStart != null ? rampOf(ev.spanStart) : null;
      if (!way) return;
      const k = staff.events.findIndex((x, j) => j > i && x.spanEnd);
      begins.push({ t: at[i], way, target: null, until: k < 0 ? end : at[k] });
    });
  }
  const seen = new Set();
  const ramps = begins.sort((a, b) => a.t - b.t).filter((b) => !seen.has(b.t) && seen.add(b.t));
  stops.sort((a, b) => a.t - b.t);
  const step = (b) => qpmOf(speedAt(score, b));
  const out = [];
  let held = null;
  ramps.forEach((r, k) => {
    // A speed a glide left behind holds until the next indication.
    if (held && stops.some((s) => s.t >= held.t0 && s.t <= r.t)) {
      const stop = stops.find((s) => s.t >= held.t0);
      if (stop.t > held.t0) out.push({ t0: held.t0, t1: stop.t, q0: held.q, q1: held.q });
      held = null;
    }
    const stop = stops.find((s) => s.t > r.t);
    const next = ramps[k + 1]?.t ?? Infinity;
    const t1 = Math.min(r.until ?? Infinity, stop?.t ?? Infinity, next, end);
    if (held) out.push({ t0: held.t0, t1: r.t, q0: held.q, q1: held.q });
    const from = held ? held.q : step(r.before ?? barAt(score, r.t));
    held = null;
    if (t1 <= r.t) return;
    const reached = stop && stop.t === t1 && r.until == null ? stop.qpm : null;
    const to = r.target ?? reached ?? from * RAMP_FACTOR[r.way];
    out.push({ t0: r.t, t1, q0: from, q1: to });
    // Arrived without a new speed written there: the glide's speed holds.
    if (!(stop && stop.t === t1 && stop.back) && r.target == null) held = { t0: t1, q: to };
  });
  if (held) {
    const stop = stops.find((s) => s.t >= held.t0);
    const t1 = Math.min(stop?.t ?? end, end);
    if (t1 > held.t0) out.push({ t0: held.t0, t1, q0: held.q, q1: held.q });
  }
  return out;
}

/**
 * Bar `b`'s speed where the ramps touch it, as pieces over the bar: [{ x0,
 * x1, q0, q1 }] in ticks from its start, quarters a minute — null where none does.
 */
function curveOf(score, ramps, b) {
  const from = barStart(score, b);
  const length = barLength(score, b);
  const touching = ramps.filter((r) => r.t0 < from + length && r.t1 > from);
  if (!touching.length) return null;
  const plain = qpmOf(speedAt(score, b));
  const edges = [...new Set([0, length, ...touching.flatMap((r) => [r.t0 - from, r.t1 - from]).filter((x) => x > 0 && x < length)])].sort((x, y) => x - y);
  const pieces = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const [x0, x1] = [edges[k], edges[k + 1]];
    const r = touching.find((u) => u.t0 - from <= x0 && u.t1 - from >= x1);
    const at = (x) => (r ? r.q0 + ((r.q1 - r.q0) * (x + from - r.t0)) / (r.t1 - r.t0) : plain);
    pieces.push({ x0, x1, q0: at(x0), q1: at(x1) });
  }
  return pieces;
}

/** Seconds from `a` to `b` (ticks into the bar) along a bar's curve. */
function curveTime(curve, a, b) {
  let sec = 0;
  for (const p of curve) {
    const [x0, x1] = [Math.max(a, p.x0), Math.min(b, p.x1)];
    if (x1 <= x0) continue;
    const at = (x) => p.q0 + ((p.q1 - p.q0) * (x - p.x0)) / (p.x1 - p.x0);
    const [qa, qb] = [at(x0), at(x1)];
    // The speed gliding evenly in ticks: the time is its inverse's integral.
    const span = Math.abs(qb - qa) < 1e-9 ? (x1 - x0) / qa : ((x1 - x0) * Math.log(qb / qa)) / (qb - qa);
    sec += (span * 240) / WHOLE;
  }
  return sec;
}

/** A bar's speed (quarters a minute) at `x` ticks into it, along its curve. */
function curveSpeed(curve, x) {
  const p = curve.find((u) => x >= u.x0 && x < u.x1) ?? curve[curve.length - 1];
  return p.q0 + ((p.q1 - p.q0) * (Math.min(x, p.x1) - p.x0)) / (p.x1 - p.x0);
}

// ---- Quantizing what the score holds -----------------------------------------------------
//
// The score is notation: every note already sits on some grid. Quantizing
// moves notes that sit on a finer one (a recording fitted to thirty-seconds,
// swing written out as dotted rhythms) to a coarser grid: a note's start goes
// to the nearest step of the grid, counted from its bar line, or part of the
// way (`strength`, 0 to 1); its end with it (as long as it was), or to the
// grid too (`ends`). Notes landing together make a chord; a note reaching the
// next one's start is cut there. Their articulations, dynamics and words go
// with them. On a triplet grid, or over a tuplet, the notes are rewritten as
// a recording is: the pitches and the rhythm kept, not what is written on them.

/** The finest step a partial quantize lands on: a sixty-fourth. */
const FINE = WHOLE / 64;

/**
 * Lane `s`'s notes starting from `from` to `to` (ticks) quantized to `grid`
 * (ticks; RECORDING_GRIDS lists them). Answers how many notes moved.
 */
export function quantizeLane(score, s, from, to, { grid, strength = 1, ends = false } = {}) {
  const staff = score.staves[s];
  if (!staff) throw new Error("no such staff");
  if (!(grid > 0)) throw new Error("choose a grid");
  const amount = Math.max(0, Math.min(1, Number(strength)));
  const at = starts(staff);
  const near = (t, step) => {
    const bar = barStart(score, barAt(score, t));
    return bar + Math.round((t - bar) / step) * step;
  };
  const triplet = Boolean(tripletBeat(grid));
  // Part of the way lands on a sixty-fourth; a triplet grid always all the way.
  const moved = (t) => (amount < 1 && !triplet ? near(t + (near(t, grid) - t) * amount, FINE) : near(t, grid));
  const inRange = (i) => at[i] >= from && at[i] < to;
  const tuplets = staff.events.some((ev, i) => inRange(i) && ev.tuplet);
  if (triplet || tuplets) {
    const played = notesOf(score, s, from, to);
    if (!played.length) return 0;
    const step = amount < 1 && !triplet ? FINE : grid;
    const notes = played.map((n) => {
      const t0 = moved(n.t0);
      return { ...n, t0, t1: Math.max(t0 + step, ends ? moved(n.t1) : t0 + (n.t1 - n.t0)) };
    });
    const end = Math.max(to, ...notes.map((n) => n.t1));
    writeRecording(score, s, from, nextBarLine(score, end - 1), notes, step);
    return new Set(played.filter((n, k) => n.t0 !== notes[k].t0 || n.t1 !== notes[k].t1).map((n) => n.t0)).size;
  }
  const items = [];
  for (let i = 0; i < staff.events.length; i++) {
    const ev = staff.events[i];
    if (ev.rest || !inRange(i)) continue;
    const [a, b] = tiedNotes(staff, i);
    if (a !== i) continue;
    const { base, dots, tuplet, id, tie, ...content } = structuredClone(ev);
    items.push({ t0: at[a], t1: at[b] + ticksOf(staff.events[b]), content });
  }
  if (!items.length) return 0;
  const end = Math.max(to, ...items.map((n) => n.t1));
  let count = 0;
  const placed = [];
  for (const n of items) {
    const t0 = Math.max(from, Math.min(end - FINE, moved(n.t0)));
    let t1 = ends ? moved(n.t1) : t0 + (n.t1 - n.t0);
    if (t1 <= t0) t1 = t0 + (ends ? grid : n.t1 - n.t0);
    if (t0 !== n.t0 || t1 !== n.t1) count++;
    const same = placed.find((p) => p.t0 === t0);
    if (same) {
      // Landing together: one chord.
      for (const p of n.content.pitches) if (!same.content.pitches.some((q) => q.d === p.d && q.alter === p.alter && q.drum === p.drum)) same.content.pitches.push(p);
      same.content.pitches = sortPitches(same.content.pitches);
      same.t1 = Math.max(same.t1, t1);
    } else placed.push({ t0, t1, content: n.content });
  }
  placed.sort((x, y) => x.t0 - y.t0);
  placed.forEach((n, k) => {
    // A note reaching the next one's start stops there.
    if (placed[k + 1]) n.t1 = Math.min(n.t1, placed[k + 1].t0);
  });
  write(score, s, from, end - from, { rest: true });
  for (const n of placed) write(score, s, n.t0, n.t1 - n.t0, { ...n.content, rest: false, tie: false });
  return count;
}

/** Lane `s`'s notes starting from `from` to `to`, as keys played: [{ key, t0, t1 }], a tied note once. */
function notesOf(score, s, from, to) {
  const staff = score.staves[s];
  const at = starts(staff);
  const out = [];
  staff.events.forEach((ev, i) => {
    if (ev.rest || at[i] < from || at[i] >= to) return;
    const [a, b] = tiedNotes(staff, i);
    if (a !== i) return;
    const t1 = at[b] + ticksOf(staff.events[b]);
    for (const p of ev.pitches) out.push({ key: p.drum ? drumKey(p.drum) : midiKey(p.d, p.alter), t0: at[i], t1 });
  });
  return out;
}

// ---- Swing, written into the notes ------------------------------------------------------

/**
 * Each pair of even eighths (`unit` 8) or sixteenths (16) on lane `s`, on
 * the beat, from `from` to `to`, written swung: "dotted" a dotted note and
 * the short one, "triplet" a triplet of the long and the short. Notes and
 * rests alike; a pair already uneven, or in a tuplet, is left. Answers how
 * many pairs.
 */
export function writeSwing(score, s, from, to, { unit = 8, feel = "triplet" } = {}) {
  const staff = score.staves[s];
  if (!staff) throw new Error("no such staff");
  if (unit !== 8 && unit !== 16) throw new Error("swing is of eighths or sixteenths");
  const step = WHOLE / unit;
  const at = starts(staff);
  let count = 0;
  for (let i = 0; i + 1 < staff.events.length; i++) {
    const [a, b] = [staff.events[i], staff.events[i + 1]];
    const t = at[i];
    if (t < from || t >= to) continue;
    const bar = barAt(score, t);
    const into = t - barStart(score, bar);
    if (into % (2 * step) || into + 2 * step > barLength(score, bar)) continue;
    if ([a, b].some((ev) => ev.base !== unit || ev.dots || ev.tuplet || ev.graces?.length)) continue;
    if (feel === "dotted") {
      a.dots = 1;
      b.base = unit * 2;
    } else {
      const id = newId();
      a.base = unit / 2;
      a.tuplet = { id, n: 3, d: 2 };
      b.tuplet = { id, n: 3, d: 2 };
    }
    count++;
    i++;
  }
  return count;
}
