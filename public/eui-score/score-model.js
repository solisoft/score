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
// Every clef eui-score draws, by LilyPond's name: its sign, the line it
// sits on (half spaces from the middle line) and its octaves (-2 to 2).
const CLEF_BASES = {
  treble: ["G", -2], french: ["G", -4], soprano: ["C", -4], mezzosoprano: ["C", -2], alto: ["C", 0], tenor: ["C", 2],
  baritone: ["C", 4], varbaritone: ["F", 0], bass: ["F", 2], subbass: ["F", 4],
};
const OCTAVE_MARKS = { "-2": "_15", "-1": "_8", 1: "^8", 2: "^15" };
const CLEF_SHAPES = Object.fromEntries([
  ...Object.entries(CLEF_BASES).flatMap(([name, [sign, line]]) => [-2, -1, 0, 1, 2].map((oct) => [name + (OCTAVE_MARKS[oct] ?? ""), [sign, line, oct]])),
  ["percussion", ["Percussion", 0, 0]],
]);
/** The clefs a staff may be in. */
export const CLEFS = Object.keys(CLEF_SHAPES);

/** Clef `clef` as MusicXML writes it: its sign, its line (1 the bottom one) and its octaves. */
export function clefShape(clef) {
  const [sign, line, octave] = CLEF_SHAPES[clef] ?? CLEF_SHAPES.treble;
  return sign === "Percussion" ? ["percussion", 0, 0] : [sign, 3 + line / 2, octave];
}

/** The `d` of clef `clef`'s middle line (c' is 7); a treble clef's for one it does not know. */
export function clefMiddle(clef) {
  const [sign, line, octave] = CLEF_SHAPES[clef] ?? CLEF_SHAPES.treble;
  if (sign === "Percussion") return 7;
  return { G: 11, C: 7, F: 3 }[sign] - line + 7 * octave;
}
const SCRIPTS = {
  staccato: "-.", accent: "->", tenuto: "--", marcato: "-^", staccatissimo: "-!", portato: "-_", fermata: "\\fermata",
  trill: "\\trill", prall: "\\prall", mordent: "\\mordent", turn: "\\turn",
  // Bowings, a harmonic's circle and the espressivo (Soli 2.28.5).
  upbow: "\\upbow", downbow: "\\downbow", flageolet: "\\flageolet", espressivo: "\\espressivo",
  // A brass mute's: open (o) and stopped (+). Read and written back; on a drum, the hi-hat's.
  open: "\\open", stopped: "\\stopped",
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
/** The articulations the tools offer: every one the model keeps but a brass mute's. */
export const ARTICULATIONS = Object.keys(SCRIPTS).filter((name) => !["open", "stopped"].includes(name));
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

/** The ticks an event lasts: its written value, scaled by its tuplet (and the tuplet around that one). */
export function ticksOf(ev) {
  // \\scaleDurations n/d (#408): the written value lasts n/d of itself.
  const written = notated(ev.base, ev.dots) * (ev.scale ? ev.scale[0] / ev.scale[1] : 1);
  if (!ev.tuplet) return written;
  const outer = ev.tuplet.outer;
  return (written * ev.tuplet.d * (outer ? outer.d : 1)) / (ev.tuplet.n * (outer ? outer.n : 1));
}

// A tuplet in a tuplet (a triplet in a quintuplet): the inner one is the
// event's `tuplet`, the one around it its `tuplet.outer`; an event of the
// outer one only has it as its `tuplet`. Edits treat the outer one whole.

/** The id of the outermost tuplet an event is in, or null. */
export function tupletGroup(ev) {
  return ev?.tuplet ? ev.tuplet.outer?.id ?? ev.tuplet.id : null;
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
    if (!c.time && !c.len) continue;
    let prev = out[out.length - 1];
    // A change where the bar after one of its own length starts: in its place.
    if (prev.bar === c.bar && out.length > 1) {
      out.pop();
      prev = out[out.length - 1];
    }
    const start = prev.start + (c.bar - prev.bar) * prev.len;
    const time = c.time ?? prev.time;
    const len = (WHOLE * time[0]) / time[1];
    if (c.bar === 0 && c.len) {
      // The first bar its own length: a pickup's place, its own start.
      out.splice(0, out.length, { bar: 0, start: 0, len: c.len, time, odd: true }, { bar: 1, start: c.len, len, time });
    } else if (c.len) {
      // A bar of its own length (a cadenza, a bar a bar line cut short), then the metre again.
      out.push({ bar: c.bar, start, len: c.len, time, odd: true }, { bar: c.bar + 1, start: start + c.len, len, time });
    } else out.push({ bar: c.bar, start, len, time });
  }
  return out;
}

/** Whether bar `b` is one of its own length: a cadenza, or a bar a bar line ends before its metre does. */
export function isOddBar(score, b) {
  return Boolean(changeAt(score, b)?.len);
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
  refuseRawBars(score);
  if (score.staves.some((_, s) => isScaled(score, s))) throw new Error(SCALED_METRE);
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

/**
 * The score's tempo indications after its start, in order: [{ bar, pos, tempo }],
 * those at bar lines (`score.changes`) and those inside bars (`score.midTempos`).
 */
function tempoMarks(score) {
  const marks = [...(score.changes ?? []).filter((c) => c.tempo).map((c) => ({ bar: c.bar, pos: 0, tempo: c.tempo })), ...(score.midTempos ?? [])];
  return marks.sort((x, y) => x.bar - y.bar || x.pos - y.pos);
}

/** The tempo in force in bar `b` (at `pos` ticks into it; Infinity: at its end): { text, base, bpm }, or null. */
export function tempoAt(score, b, pos = 0) {
  let tempo = score.tempo;
  for (const m of tempoMarks(score)) if (m.bar < b || (m.bar === b && m.pos <= pos)) tempo = { ...(tempo ?? {}), ...m.tempo, text: m.tempo.text ?? "" };
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

// What is counted in bars beside `score.changes`: the score's changes inside
// bars, and each staff's own — `{ bar, … }` each, moved with their bars.
const SCORE_LISTS = ["midKeys", "midTempos", "midMarks"];
const STAFF_LISTS = ["clefs", "midClefs", "keys", "times"];

/** Every list of `{ bar, … }` the score keeps beside its changes, with where it lives: [[holder, name]]. */
function barLists(score) {
  return [...SCORE_LISTS.map((name) => [score, name]), ...score.staves.flatMap((staff) => STAFF_LISTS.map((name) => [staff, name]))].filter(([holder, name]) => holder[name]);
}

/** When `t` sounds, in seconds, with the tempo changes on the way (100 a quarter when none is set). */
export function secondsAt(score, t) {
  const marks = [{ at: 0, tempo: score.tempo }, ...tempoMarks(score).filter((m) => m.tempo.bpm).map((m) => ({ at: barStart(score, m.bar) + m.pos, tempo: tempoAt(score, m.bar, m.pos) }))];
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
  if (s == null) refuseRawBars(score);
  else refuseRaw(score, s);
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
    for (const staff of score.staves) for (const m of staff.keys ?? []) m.key = clamp(m.key + f);
    for (const c of score.changes ?? []) if (c.key != null) c.key = clamp(c.key + f);
    for (const m of score.midKeys ?? []) m.key = clamp(m.key + f);
  }
  if (s != null) refuseDrums(score, s);
  // An ossia goes with the whole score.
  if (s == null) for (const staff of score.staves) for (const o of staff.ossias ?? []) for (const ev of o.events) if (!ev.rest) ev.pitches = ev.pitches.map((p) => transposePitch(p, steps, semitones));
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
      for (const g of [...ev.graces, ...(ev.afterGraces ?? [])]) moveGraceTo(g, g.pitches.map((p) => transposePitch(p, steps, semitones)));
      if (s == null && ev.chord && ev.chord !== "N.C.") ev.chord = transposeChord(ev.chord, steps, semitones);
      if (s == null && ev.chordmode && ev.chordmode !== "r") ev.chordmode = transposeChordmode(ev.chordmode, steps, semitones);
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

/** Rests filling `ticks` from `at` in `lane`: drawn at its scale when every event of it is scaled alike (\\scaleDurations). */
function laneRests(score, lane, at, ticks) {
  const scale = scaleOf(lane);
  if (!scale) return rests(score, at, ticks);
  const [n, d] = scale;
  if ((ticks * d) % n) return rests(score, at, ticks);
  const out = [];
  let t = at;
  const end = at + ticks;
  while (t < end - 1e-6) {
    const piece = Math.min(end, nextBarLine(score, t)) - t;
    for (const v of spellDuration((piece * d) / n)) out.push(makeEvent({ base: v.base, dots: v.dots, scale: [n, d] }));
    t += piece;
  }
  return out;
}

/** The scale every event of `lane` is drawn at, [n, d], when they share one; else null. */
function scaleOf(lane) {
  const first = lane.events[0]?.scale;
  return first && lane.events.every((ev) => ev.scale && ev.scale[0] === first[0] && ev.scale[1] === first[1]) ? first : null;
}

/** Whether lane `s` holds notes scaled by \\scaleDurations. */
export function isScaled(score, s) {
  return Boolean(score.staves[s]?.events.some((ev) => ev.scale));
}

const SCALED_METRE = "A staff's notes are scaled (\\scaleDurations, a metre beside another): change the metre or the pickup in the text below";
const SCALED_REFUSAL = "The notes of this staff are scaled (\\scaleDurations, a metre beside another): change their lengths in the text below";

/** An edit that would change the lengths of notes in a scaled lane: refused, said. */
function refuseScaled(score, s) {
  if (isScaled(score, s)) throw new Error(SCALED_REFUSAL);
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
  const id = tupletGroup(staff.events[index]);
  if (id == null) return [index, index];
  let a = index;
  let b = index;
  while (a > 0 && tupletGroup(staff.events[a - 1]) === id) a--;
  while (b < staff.events.length - 1 && tupletGroup(staff.events[b + 1]) === id) b++;
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
      // A chord of a line of chord names is named once, where it starts; so is a figure, a chord diagram.
      delete p.chordmode;
      delete p.artDirs;
      delete p.before;
      delete p.figure;
      delete p.figureRaw;
      delete p.fret;
      delete p.fretBelow;
    }
    if (!(last && keepsEnd)) {
      delete p.beamEnd;
      delete p.phraseEnd;
      // A breath is taken, a tie let ring, a text span ended after the last piece; \\afterGrace's notes follow it.
      delete p.breath;
      delete p.afterGraces;
      delete p.afterAt;
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
  if (score.staves.some((staff) => (staff.raw != null || staff.rawPart) && lengthOf(staff) < want)) throw new Error(RAW_BARS_REFUSAL);
  for (const staff of score.staves) {
    const have = lengthOf(staff);
    if (have < want) staff.events.push(...laneRests(score, staff, have, want - have));
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
  refuseRaw(score, s);
  refuseScaled(score, s);
  if ((staff.chords || staff.figures) && content.rest === false) throw new Error(staff.chords ? CHORD_LINE_NOTES : FIGURE_LINE_NOTES);
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
  // A setting that holds on (\\override …) stays where the music goes on: on what is written first.
  const held = heldCommands(replaced);
  const then = Object.fromEntries(Object.keys(MARKERS).map((field) => [field, markerAt(staff, b - 1, field)]));
  const lastMarkers = Object.fromEntries(Object.keys(MARKERS).map((field) => [field, replaced.findLast((ev) => ev[field] != null)?.[field]]));
  staff.events.splice(a, b - a, ...fill);
  if (held.length) fill[0].before = [...held, ...(fill[0].before ?? [])];
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
  const marked = ev.before?.length || ev.cue || ev.ottava != null || ev.stemDir != null || ev.noAutoBeam != null || ev.breath || ev.spanStart != null || ev.spanEnd || ev.cross != null || ev.figure || ev.figureRaw || ev.fret;
  return ev.rest && !ev.tuplet && !ev.scale && !ev.dynamic && !ev.hairpin && !ev.hairpinEnd && !ev.texts.length && !ev.chord && !ev.arts.length && !ev.pedalOn && !ev.pedalOff && !ev.beamStart && !ev.beamEnd && !marked;
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
  refuseRaw(score, s);
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
  // The staff's middle line.
  return clefMiddle(score.staves[upperOf(score, s)].clef);
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
  delete ev.afterGraces;
  delete ev.afterAt;
  delete ev.phraseStart;
  delete ev.phraseEnd;
  delete ev.forced;
  delete ev.cautionary;
  delete ev.lv;
  delete ev.repeatTie;
  delete ev.cross;
  delete ev.fret;
  delete ev.fretBelow;
  const prev = score.staves[s].events[i - 1];
  if (prev && prev.tie) prev.tie = false;
  tidy(score, score.staves[s]);
}

/** Event `i` written with another value: shorter leaves a rest, longer writes over what follows. */
export function setDuration(score, s, i, base, dots) {
  refuseScaled(score, s);
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

// ---- Stems, beams written by hand, enharmonic spelling ------------------------------

/** The lane of `s` whose events `a`…`b` a command changes: refused on a line of chord names; first and last index. */
function laneRange(score, s, a, b) {
  const staff = score.staves[s];
  if (!staff) throw new Error("no such staff");
  if (staff.chords || staff.figures) throw new Error(staff.chords ? CHORD_LINE_NOTES : FIGURE_LINE_NOTES);
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  if (!staff.events[from] || !staff.events[to]) throw new Error("no such note");
  return [staff, from, to];
}

/**
 * The stems of events `a`…`b`: `dir` 1 up (\stemUp), -1 down (\stemDown), 0
 * as the voice or the engraver wants (\stemNeutral). What follows keeps the
 * stems it had.
 */
export function setStem(score, s, a, b, dir) {
  if (![-1, 0, 1].includes(dir)) throw new Error("a stem goes up, down, or as the voice wants");
  const [staff, from, to] = laneRange(score, s, a, b);
  const after = markerAt(staff, to, "stemDir");
  for (let k = from; k <= to; k++) delete staff.events[k].stemDir;
  staff.events[from].stemDir = dir;
  const next = staff.events[to + 1];
  if (next && next.stemDir == null) next.stemDir = after;
  tidyMarkers(staff, "stemDir");
}

/** The stem direction in force at event `i` of lane `s`: 1 up, -1 down, 0 the voice's. */
export function stemAt(score, s, i) {
  return markerAt(score.staves[s], i, "stemDir");
}

/** The beam written by hand event `i` is under, as `[first, last]`, or null. */
export function handBeamAt(score, s, i) {
  const staff = score.staves[s];
  const marks = handBeams(score, staff);
  let open = -1;
  for (let k = 0; k < marks.length; k++) {
    if (marks[k] === "[") open = k;
    if (marks[k] === "]" && open >= 0) {
      if (i >= open && i <= k) return [open, k];
      open = -1;
    }
  }
  return null;
}

/**
 * Events `a`…`b` under one beam written by hand (`[ ]`): the beams by hand
 * inside them joined; the same beam again takes it away. Its notes are an
 * eighth or shorter, in one bar and one tuplet, its ends notes.
 */
export function toggleBeam(score, s, a, b) {
  const [staff, a0, b0] = laneRange(score, s, a, b);
  const same = handBeamAt(score, s, a0);
  if (same && same[0] === a0 && same[1] === b0) {
    delete staff.events[a0].beamStart;
    delete staff.events[b0].beamEnd;
    return;
  }
  // The hand beams it reaches into are joined into it.
  const from = Math.min(a0, handBeamAt(score, s, a0)?.[0] ?? a0);
  const to = Math.max(b0, handBeamAt(score, s, b0)?.[1] ?? b0);
  if (from === to) throw new Error("a beam joins two notes or more: select them");
  const events = staff.events.slice(from, to + 1);
  const at = starts(staff);
  if (staff.events[from].rest || staff.events[to].rest) throw new Error("a beam starts and ends on a note");
  if (events.some((ev) => !ev.rest && ev.base < 8)) throw new Error("only eighths and shorter notes are beamed");
  if (barAt(score, at[from]) !== barAt(score, at[to])) throw new Error("a beam stays in its bar");
  if (events.some((ev) => tupletGroup(ev) !== tupletGroup(events[0]))) throw new Error("a beam stays in its tuplet");
  for (const ev of events) {
    delete ev.beamStart;
    delete ev.beamEnd;
  }
  staff.events[from].beamStart = true;
  staff.events[to].beamEnd = true;
}

/**
 * The beam written by hand broken before note `i`: what is before it one
 * beam, what is from it on another — a part of one note left unbeamed.
 */
export function breakBeam(score, s, i) {
  const [staff] = laneRange(score, s, i, i);
  const beam = handBeamAt(score, s, i);
  if (!beam) throw new Error("this note's beam is the engraver's own: select the notes and beam them by hand (Alt+B) to break it");
  if (beam[0] === i) throw new Error("the beam starts on this note: select a note inside it");
  const [first, last] = beam;
  delete staff.events[first].beamStart;
  delete staff.events[last].beamEnd;
  const notes = (a, b) => staff.events.slice(a, b + 1).filter((ev) => !ev.rest).length;
  // Before it: up to the last note before it.
  let end = i - 1;
  while (end > first && staff.events[end].rest) end--;
  if (notes(first, end) > 1) {
    staff.events[first].beamStart = true;
    staff.events[end].beamEnd = true;
  }
  let start = i;
  while (start < last && staff.events[start].rest) start++;
  if (notes(start, last) > 1) {
    staff.events[start].beamStart = true;
    staff.events[last].beamEnd = true;
  }
}

/** The spellings of a pitch, the same key on the piano: C♯ and D♭, E, F♭ and D𝄪 — its own first. */
export function spellings(p) {
  const key = midiKey(p.d, p.alter);
  const out = [{ ...p }];
  for (const d of [p.d + 1, p.d - 1, p.d + 2, p.d - 2]) {
    const alter = key - midiKey(d, 0);
    if (Math.abs(alter) <= 2) out.push({ d, alter });
  }
  // The plainest first after its own: fewer sharps or flats.
  return [out[0], ...out.slice(1).sort((x, y) => Math.abs(x.alter) - Math.abs(y.alter) || x.d - y.d)];
}

/** A pitch spelled the next way: C♯ is D♭, D♭ C♯; E is F♭, then D𝄪, then E. */
export function respell(p) {
  const all = spellings(p);
  return all[1] ?? all[0];
}

/** Notes `a`…`b` of lane `s` spelled the other way (cis ↔ des) — head `head` of a chord, or every head — with the notes tied to them. */
export function enharmonic(score, s, a, b, head = -1) {
  const [staff, from, to] = laneRange(score, s, a, b);
  refuseDrums(score, s);
  let done = 0;
  for (let i = from; i <= to; i++) {
    const ev = staff.events[i];
    if (ev.rest || (i > from && staff.events[i - 1].tie && sameNote(staff.events[i - 1], ev))) continue;
    const now = ev.pitches.map((p, k) => (head < 0 || from !== to || k === head ? respell(p) : p));
    followHeads(ev, ev.pitches, now);
    setPitches(score, s, i, sortPitches(now));
    done++;
  }
  if (!done) throw new Error("select the notes to spell the other way");
}

// ---- Notes drawn on the other staff -----------------------------------------------
//
// `\change Staff = "down"`: a note of one staff drawn on another — a piano's
// right hand reaching into the bass staff. `ev.cross` is the id of the staff
// it is drawn on (`staff.id`, `\new Staff = "down"`); it sounds, and is
// edited, in its own staff. Each bar is written starting and ending on its
// own staff, so the voices of a bar never inherit another's change.

/** A staff id no staff has yet: "up" and "down" for a piano's two staves, else "staffN". */
function freshStaffId(score, u) {
  const taken = new Set(score.staves.map((x) => x.id).filter(Boolean));
  const lanes = staffLanes(score);
  const n = lanes.indexOf(u);
  const brace = (score.groups ?? []).find((g) => g.kind === "brace" && g.last === g.first + 1 && (g.first === n || g.last === n));
  const piano = brace ?? (score.group === "brace" && lanes.length === 2 ? { first: 0 } : null);
  const wanted = piano ? (n === piano.first ? "up" : "down") : `staff${n + 1}`;
  let id = wanted;
  for (let k = 2; taken.has(id); k++) id = `${wanted}${k}`;
  return id;
}

/** Staff `u`'s id, given one when it has none. */
function staffId(score, u) {
  const staff = score.staves[u];
  staff.id ||= freshStaffId(score, u);
  return staff.id;
}

/** The staff event `ev` of lane `s` is drawn on, by its id: null for its own (or one the score lacks). */
export function crossOf(score, s, ev) {
  if (!ev?.cross) return null;
  const own = score.staves[upperOf(score, s)]?.id;
  if (!own || ev.cross === own) return null;
  return staffLanes(score).some((u) => score.staves[u].id === ev.cross) ? ev.cross : null;
}

/**
 * The notes `a`…`b` of lane `s` drawn on the staff above (`dir` −1) or below
 * (1); when they are all there already, back on their own staff. Rests stay.
 */
export function setCross(score, s, a, b, dir) {
  refuseDrums(score, s);
  if (isAutoChange(score, s)) throw new Error(AUTO_CROSS);
  if (isCombined(score, s)) throw new Error(COMBINE_CROSS);
  const lanes = staffLanes(score);
  const other = lanes[staffNumber(score, s) + Math.sign(dir)];
  if (other == null) throw new Error(dir < 0 ? "there is no staff above to draw the notes on" : "there is no staff below to draw the notes on");
  if (score.staves[other].drums) throw new Error("notes are not drawn on a drum staff");
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  const notes = score.staves[s].events.slice(from, to + 1).filter((ev) => !ev.rest);
  if (!notes.length) throw new Error("select the notes to draw on the other staff");
  const id = staffId(score, other);
  staffId(score, upperOf(score, s));
  const back = notes.every((ev) => crossOf(score, s, ev) === id);
  for (const ev of notes) {
    if (back) delete ev.cross;
    else ev.cross = id;
  }
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
  if (ev.artDirs?.[name] != null && !ev.arts.includes(name)) {
    delete ev.artDirs[name];
    if (!Object.keys(ev.artDirs).length) delete ev.artDirs;
  }
  // Its \\tweak goes with it.
  if (!ev.arts.includes(name) && ev.tweaks) {
    ev.tweaks = ev.tweaks.filter((x) => x.on !== `art:${name}`);
    if (!ev.tweaks.length) delete ev.tweaks;
  }
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
  moveGraceTo(last, moved);
  last.pitches = sortPitches(last.pitches);
}

/** A grace note given the pitches `now` (head by head): its fingerings follow their notes. */
function moveGraceTo(g, now) {
  if (g.fingers) g.fingers = g.fingers.map((f) => (f.head == null ? f : { ...f, head: now[g.pitches.findIndex((p) => p.d === f.head)]?.d ?? f.head }));
  g.pitches = now;
}

/**
 * Finger `text` (1–5) on the last grace note before note `i` — on its
 * top note when it is a chord; the same again takes it away.
 */
export function setGraceFingering(score, s, i, text) {
  const ev = pitchedNote(score, s, i);
  if (!ev.graces.length) throw new Error("this note has no grace note");
  const figure = String(text);
  if (!/^[1-5]$/.test(figure)) throw new Error("a finger is 1 to 5");
  const g = ev.graces[ev.graces.length - 1];
  const head = g.pitches.length > 1 ? g.pitches[g.pitches.length - 1].d : null;
  const had = (g.fingers ?? []).find((f) => !f.circled && (f.head ?? null) === head);
  const kept = (g.fingers ?? []).filter((f) => f !== had);
  if (!(had && had.text === figure)) kept.push({ text: figure, dir: had?.dir ?? 0, head, circled: false });
  if (kept.length) g.fingers = kept;
  else delete g.fingers;
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
  const ev = noteOf(score, s, i);
  const symbol = text.trim();
  if (isChords(score, s)) {
    // On a line of chord names: a chord it can write, or N.C.; the source's spelling goes.
    const none = /^n\.?c\.?$/i.test(symbol);
    if (symbol && !none) chordmodeOf(symbol);
    delete ev.chordmode;
    ev.chord = none ? "N.C." : symbol;
    return;
  }
  ev.chord = symbol;
}

/** The most verses a score's lyrics may have: a line under the staff each. */
export const MAX_VERSES = 6;

// A staff's words are sung to one of its voices: the first, or the voice its
// first lane's `lyricsVoice` names (2 to 4) — an alto's words under the
// alto's notes, `\new Lyrics \lyricsto "alto"`. `lyricsName` keeps the name
// the source gave that voice; the editor makes one up otherwise.

/** The voice the staff of lane `s` sings its words to: 1 to 4. */
export function lyricsVoiceOf(score, s) {
  return score.staves[upperOf(score, s)]?.lyricsVoice ?? 1;
}

/** The lane the words of the staff of lane `s` go under, or −1 when that voice is gone. */
export function lyricsLane(score, s) {
  return laneOfVoice(score, s, lyricsVoiceOf(score, s));
}

/** The name `\lyricsto` sings to on the staff of lane `s`: the source's, or one made of the staff's place. */
function lyricsName(score, s) {
  const staff = score.staves[upperOf(score, s)];
  return staff.lyricsName || `staff${staffNumber(score, s) + 1}voice${lyricsVoiceOf(score, s)}`;
}

/** The staff of lane `s` sings to its first voice again: what a staff whose words are all gone does. */
function lyricsBackToFirst(score, s) {
  const staff = score.staves[upperOf(score, s)];
  delete staff.lyricsVoice;
  delete staff.lyricsName;
}

/**
 * Event `i`'s syllable of verse `verse` (1 the first); empty text takes it
 * away. Words go under the voice the staff sings to; a staff with no words
 * yet sings to the voice of the first syllable written, any of its four.
 */
export function setLyric(score, s, i, text, hyphen = false, extend = false, verse = 1) {
  if (!Number.isInteger(verse) || verse < 1 || verse > MAX_VERSES) throw new Error(`a verse is 1 to ${MAX_VERSES}`);
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("a syllable goes under a note");
  if (isCombined(score, s) || isAutoChange(score, s)) throw new Error(COMBINE_WORDS);
  const voice = voiceOf(score, s);
  const sung = lyricsVoiceOf(score, s);
  if (voice !== sung) {
    const lane = lyricsLane(score, s);
    if (lane >= 0 && versesOf(score.staves[lane]) > 0) throw new Error(`this staff's words go with voice ${sung}: a staff sings all its verses to one voice`);
    if (!text.trim()) return;
    const staff = score.staves[upperOf(score, s)];
    delete staff.lyricsName;
    if (voice === 1) delete staff.lyricsVoice;
    else staff.lyricsVoice = voice;
  }
  putSyllable(ev, verse, text.trim() ? { text: text.trim(), hyphen, extend } : null);
  if (voice > 1 && versesOf(score.staves[s]) === 0) lyricsBackToFirst(score, s);
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
  refuseScaled(score, s);
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
  refuseScaled(score, s);
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
  const clip = events.map((ev) => ({ content: { ...structuredClone(ev), id: undefined }, ticks: ticksOf(ev) }));
  // What holds where the copy starts (an ottava begun before it, the stems) goes with it.
  for (const field of Object.keys(MARKERS)) {
    const held = markerAt(staff, Math.min(a, b), field);
    if (clip[0].content[field] == null && held !== MARKERS[field]) clip[0].content[field] = held;
  }
  return clip;
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
  refuseScaled(score, s);
  const staff = score.staves[s];
  const from = t;
  const end = t + clip.reduce((sum, piece) => sum + piece.ticks, 0);
  // What holds where the paste ends, as it was: it holds there again after it.
  ensureLength(score, end);
  const before = starts(staff);
  const then = Object.fromEntries(Object.keys(MARKERS).map((field) => [field, markerAt(staff, before.findLastIndex((x) => x < end), field)]));
  let last = -1;
  const placed = [];
  for (const piece of clip) {
    const { base, dots, tuplet, ...content } = piece.content;
    for (const field of Object.keys(MARKERS)) delete content[field];
    last = write(score, s, t, piece.ticks, content);
    placed.push([t, piece.content]);
    t += piece.ticks;
  }
  // The markers inside are the clipboard's own; after it, what held there.
  const at = starts(staff);
  staff.events.forEach((ev, k) => {
    if (at[k] >= from && at[k] < end) for (const field of Object.keys(MARKERS)) delete ev[field];
  });
  for (const [time, content] of placed) {
    const ev = staff.events[eventAt(staff, time)];
    for (const field of Object.keys(MARKERS)) if (ev && content[field] != null) ev[field] = content[field];
  }
  const next = staff.events[eventAt(staff, end)];
  for (const field of Object.keys(MARKERS)) {
    if (next && next[field] == null) next[field] = then[field];
    tidyMarkers(staff, field);
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
  refuseScaled(score, s);
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
  if (shift || length != null) refuseScaled(score, s);
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
  // A scaled note (\\scaleDurations) keeps its place and its length: its pitch only changes.
  if (isScaled(score, s)) {
    for (let k = a; k <= b; k++) staff.events[k].pitches = structuredClone(pitches);
    return a;
  }
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
  refuseScaled(score, lane);
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
    // A staff changing key on its own: every key of its moved as far.
    for (const m of staff.keys ?? []) m.key = clamp(m.key + to - score.key);
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
  refuseRaw(score, s);
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

/**
 * Whether chord symbols stand over lane `s`'s staff: a chord written on any
 * of its lanes' notes, or a line of chord names (addChordStaff) right above
 * it. The editor's note palette then opens under the note, not over them.
 */
export function chordsOver(score, s) {
  const u = upperOf(score, s);
  if (!score.staves[u] || score.staves[u].chords) return false;
  const lanes = [u];
  for (let k = u + 1; k < score.staves.length && isLower(score, k); k++) lanes.push(k);
  if (lanes.some((k) => score.staves[k].events.some((ev) => ev.chord))) return true;
  const n = staffLanes(score).indexOf(u);
  const above = n > 0 ? score.staves[staffLanes(score)[n - 1]] : null;
  return Boolean(above?.chords);
}

/** Which staff lane `s` is on, counted from 0. */
export function staffNumber(score, s) {
  return staffLanes(score).indexOf(upperOf(score, s));
}

// A staff's key goes with the score's, moved as far as its own (a horn in
// E♭: `staff.key`), unless it changes key apart from the others: then
// `staff.keys` lists its own changes, { bar, pos, key, mode }, and the
// score's are not its (its first key: `staff.key`, its mode `staff.mode`).

/**
 * The changes of key staff `s` writes after its start, in order:
 * [{ bar, pos, key, mode }], `key` the staff's own fifths.
 */
export function keyChanges(score, s) {
  const staff = score.staves[upperOf(score, s)];
  if (staff?.keys) return [...staff.keys].sort((x, y) => x.bar - y.bar || x.pos - y.pos);
  const own = staff?.key == null ? 0 : staff.key - score.key;
  const clamp = (k) => Math.max(-7, Math.min(7, k + own));
  return [
    ...(score.changes ?? []).filter((c) => c.key != null).map((c) => ({ bar: c.bar, pos: 0, key: clamp(c.key), ...(c.mode ? { mode: c.mode } : {}) })),
    ...(score.midKeys ?? []).map((m) => ({ bar: m.bar, pos: m.pos, key: clamp(m.key), ...(m.mode ? { mode: m.mode } : {}) })),
  ].sort((x, y) => x.bar - y.bar || x.pos - y.pos);
}

/** Staff `s`'s key and mode in force at `pos` ticks into bar `b` (Infinity: at its end). */
function staffKeyAt(score, s, b, pos = 0) {
  const staff = score.staves[upperOf(score, s)];
  let now = { key: staff?.key ?? score.key, mode: (staff?.keys ? staff.mode : null) ?? score.mode ?? "major" };
  for (const m of keyChanges(score, s)) if (m.bar < b || (m.bar === b && m.pos <= pos)) now = { key: m.key, mode: m.mode ?? "major" };
  return now;
}

/**
 * The changes of metre staff `s` writes, [{ bar, time, parts }]: the
 * score's, or its own (`staff.times`) when it changes metre apart from the
 * others — bars as long as theirs, 6/8 beside 3/4.
 */
export function timeChanges(score, s) {
  const staff = score.staves[upperOf(score, s)];
  if (staff?.times) return staff.times;
  return (score.changes ?? []).filter((c) => c.time).map((c) => ({ bar: c.bar, time: c.time, ...(c.parts ? { parts: c.parts } : {}) }));
}

/** The metre staff `s` is in, in bar `b`. */
function staffTimeAt(score, s, b) {
  const staff = score.staves[upperOf(score, s)];
  let now = staff?.time ?? score.time;
  for (const m of timeChanges(score, s)) if (m.bar <= b) now = m.time;
  return now;
}

/** The key lane `s` is written in at time `t`: the score's then, moved as far as the staff's own — or the staff's own. */
export function keyOf(score, s, t = 0) {
  const b = barAt(score, t);
  return staffKeyAt(score, s, b, t - barStart(score, b)).key;
}

/**
 * Voice `voice` (2 to 4) on the staff of lane `s`, rests to begin with, and
 * the voices before it when it has none yet: answers its lane.
 */
export function addVoice(score, s, voice = 2) {
  refuseRaw(score, s);
  if (isCombined(score, s) && voice > 2) throw new Error(COMBINE_VOICES);
  if (isAutoChange(score, s)) throw new Error(AUTO_VOICES);
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
  refuseRaw(score, s);
  if (isCombined(score, s)) throw new Error(COMBINE_VOICES);
  const lanes = voiceLanes(score, s);
  if (lanes.length < 2) throw new Error("this staff has one voice");
  const v = voice ?? (isLower(score, s) ? voiceOf(score, s) : lanes.length);
  if (v < 2 || v > lanes.length) throw new Error(`this staff has no voice ${v}`);
  const lane = lanes[v - 1];
  score.staves[lane].events = rests(score, 0, lengthOf(score.staves[lanes[0]]));
  // The words sung to it go with it.
  if (lyricsVoiceOf(score, lanes[0]) === v) lyricsBackToFirst(score, lanes[0]);
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
  refuseRawBars(score);
  if (score.staves.some((_, s) => isScaled(score, s))) throw new Error(SCALED_METRE);
  const bars = barsOf(score);
  if (b < 0 || b >= bars) throw new Error("no such bar");
  if (![1, 2, 4, 8, 16].includes(den) || !Number.isInteger(num) || num < 1 || num > 32) throw new Error("no such metre");
  const len = (WHOLE * num) / den;
  if (score.staves.some((staff) => staff.times?.length)) throw new Error("a staff changes metre on its own: change its metres in the text");
  if (score.staves.some((staff) => (staff.ossias ?? []).some((o) => o.bar + o.bars > b))) throw new Error("an ossia stands over those bars: change the metre in the text");
  // A bar of its own length counts as itself, whatever the metre: those after it are not laid out again.
  if ((score.changes ?? []).some((c) => c.len && c.bar >= b)) throw new Error("a cadenza or a bar cut short comes later: the metre changes from the bar after it");
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
  // A metre set from the menu is a plain one: an added-up one's parts go.
  const { parts: _parts, ...own } = old.changes.find((c) => c.bar === b) ?? {};
  marks.push({ ...own, bar: b, at: from, time: [num, den] });
  marks.sort((x, y) => x.at - y.at);
  const repeats = (score.repeats ?? []).map((r) => ({ from: tick(r.from), to: tick(r.to + 1), ends: r.endings.map((_, k) => tick(r.to + 1 + r.endings.slice(0, k + 1).reduce((x, y) => x + y, 0))), times: r.times }));
  const clefs = score.staves.map((staff) => (staff.clefs ?? []).map((c) => ({ ...c, at: tick(c.bar) })));
  // The changes inside bars keep their time: they may fall anywhere.
  const midClefs = score.staves.map((staff) => (staff.midClefs ?? []).map((c) => ({ ...c, at: tick(c.bar) + c.pos })));
  const ownKeys = score.staves.map((staff) => staff.keys?.map((m) => ({ ...m, at: tick(m.bar) + m.pos })));
  const mids = Object.fromEntries(SCORE_LISTS.map((name) => [name, (score[name] ?? []).map((m) => ({ ...m, at: tick(m.bar) + m.pos }))]));
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
      if (change.time && change.time[0] === (seg.time ?? score.time)[0] && change.time[1] === (seg.time ?? score.time)[1] && String(change.parts ?? []) === String(seg.parts ?? [])) delete change.time;
      if (!change.time) delete change.parts;
      if (Object.keys(change).length > 1) changes.push(change);
    }
    if (m.time) seg = bar === 0 && pickup ? { bar: 1, at: pickup, len: (WHOLE * m.time[0]) / m.time[1], time: m.time, parts: m.parts } : { bar, at, len: (WHOLE * m.time[0]) / m.time[1], time: m.time, parts: m.parts };
    // A bar of its own length before the bars laid out again: the metre goes on after it.
    if (m.len) seg = { ...seg, bar: bar + 1, at: at + m.len };
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
  ownKeys.forEach((list, k) => {
    if (list) score.staves[k].keys = list.map(placed);
  });
  for (const name of SCORE_LISTS) if (mids[name].length) score[name] = mids[name].map(placed);
  // The music of those bars, laid out again.
  for (const [k, staff] of score.staves.entries()) {
    const at = starts(staff);
    const before = staff.events.filter((_, i) => at[i] < from);
    const inside = staff.events.map((ev, i) => ({ ev, t: at[i] })).filter(({ t }) => t >= from && t < to);
    const after = staff.events.filter((_, i) => at[i] >= to);
    staff.events = [...before, ...rests(score, from, to - from + grown), ...after];
    for (const { ev, t } of inside) {
      if (ev.rest && !ev.dynamic && !ev.texts.length && !ev.chord && !ev.hairpin && !ev.hairpinEnd && !ev.pedalOn && !ev.pedalOff && !ev.before?.length) continue;
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
  // A staff changing key on its own changes here too, as far from the score's as it stood.
  for (const s of staffLanes(score)) {
    const staff = score.staves[s];
    if (!staff.keys) continue;
    const was = staffKeyAt(score, s, b - 1, Infinity).key;
    const mine = to == null ? null : Math.max(-7, Math.min(7, to + was - scoreKeyAt(score, b - 1, Infinity)));
    staff.keys = staff.keys.filter((m) => !(m.bar === b && m.pos === 0));
    if (mine != null && mine !== was) staff.keys = [...staff.keys, { bar: b, pos: 0, key: mine }].sort((x, y) => x.bar - y.bar || x.pos - y.pos);
  }
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
  if (staff.tab) throw new Error("a tablature has no clef: its lines are the strings");
  refuseRaw(score, s);
  if (staff.autoChange) throw new Error(AUTO_CLEFS);
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
  // The notes drawn on it go back to their own staves.
  const id = score.staves[u].id;
  const count = voiceLanes(score, u).length;
  score.staves.splice(u, count);
  // What the meta line keys by lane: the staff's own go, the later lanes' move back.
  if (score.meta) {
    const gone = (lane) => Number(lane) >= u && Number(lane) < u + count;
    if (score.meta.velocity) score.meta.velocity = Object.fromEntries(Object.entries(score.meta.velocity).filter(([key]) => !gone(key.split(":")[0])));
    for (const part of [score.meta.cc, score.meta.mixer?.tracks, score.meta.synth, score.meta.soundfont]) for (const lane of Object.keys(part ?? {})) if (gone(lane)) delete part[lane];
    for (const name of ["synth", "soundfont"]) if (score.meta[name] && !Object.keys(score.meta[name]).length) delete score.meta[name];
    shiftMetaLanes(score.meta, u + count, -count);
  }
  if (id) for (const lane of score.staves) for (const ev of lane.events) if (ev.cross === id) delete ev.cross;
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
  refuseRawBars(score);
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
  }
  score.changes = (score.changes ?? []).filter((c) => c.bar < bars - 1);
  for (const [holder, name] of barLists(score)) holder[name] = holder[name].filter((m) => m.bar < bars - 1);
  for (const staff of score.staves) ossiasAfterDelete(staff, bars - 1, bars - 1, 1);
}

/**
 * Bars `a`…`b` taken away from every staff, whatever they hold; the bars
 * after them keep their key, metre, tempo and clef, and the repeats after
 * them move back. A repeat the bars are part of is the person's to remove
 * first, as for the last bar.
 */
export function deleteBars(score, a, b) {
  refuseRawBars(score);
  const bars = barsOf(score);
  [a, b] = [Math.min(a, b), Math.max(a, b)];
  if (a < 0 || b >= bars) throw new Error("no such bar");
  const count = b - a + 1;
  if (count >= bars) throw new Error("a score keeps one bar at least");
  if ((score.repeats ?? []).some((r) => r.from <= b && repeatEnd(r) >= a)) throw new Error("these bars are in a repeat: remove the repeat first");
  // What is in force after the bars, before they go.
  const after = { key: scoreKeyAt(score, b, Infinity), time: timeAt(score, b), tempo: tempoAt(score, b, Infinity) };
  const before = a > 0 ? { key: scoreKeyAt(score, a - 1, Infinity), time: timeAt(score, a - 1), tempo: tempoAt(score, a - 1, Infinity) } : { key: score.key, time: score.time, tempo: score.tempo };
  const own = changeAt(score, b + 1) ?? {};
  const clefsAfter = score.staves.map((staff, s) => (staff.voice ? null : clefAt(score, s, b, Infinity)));
  // A staff with keys and metres of its own: what holds after the bars, and before them.
  const ownAfter = score.staves.map((staff, s) => ({ key: staff.keys ? staffKeyAt(score, s, b, Infinity) : null, time: staff.times ? staffTimeAt(score, s, b) : null }));
  const ownBefore = score.staves.map((staff, s) => ({ key: staff.keys ? staffKeyAt(score, s, a - 1, Infinity) : null, time: staff.times ? staffTimeAt(score, s, a - 1) : null }));
  const clefsBefore = score.staves.map((staff, s) => (staff.voice ? null : a > 0 ? clefAt(score, s, a - 1, Infinity) : staff.clef));
  const from = barStart(score, a);
  const to = barStart(score, b + 1);
  for (const staff of score.staves) {
    const at = starts(staff);
    // What holds after the bars (an ottava, the stems, the beaming) holds there still.
    const last = at.findLastIndex((t) => t < to);
    const then = Object.fromEntries(Object.keys(MARKERS).map((field) => [field, markerAt(staff, last, field)]));
    const held = heldCommands(staff.events.filter((_, k) => at[k] >= from && at[k] < to));
    staff.events = staff.events.filter((_, k) => at[k] < from || at[k] >= to);
    const next = staff.events[at.filter((t) => t < from).length];
    // The settings that hold on from the bars taken away go on with the music after them.
    if (next && held.length) next.before = [...held, ...(next.before ?? [])];
    for (const field of Object.keys(MARKERS)) {
      if (next && next[field] == null) next[field] = then[field];
      tidyMarkers(staff, field);
    }
    mend(staff);
  }
  // The pickup gone, the piece starts on a full bar.
  if (a === 0) delete score.pickup;
  // The changes and clefs inside the bars go; those after them move back.
  const shift = (list) => (list ?? []).filter((c) => c.bar < a || c.bar > b).map((c) => (c.bar > b ? { ...c, bar: c.bar - count } : c));
  score.changes = shift(score.changes);
  for (const [holder, name] of barLists(score)) if (holder === score) holder[name] = shift(holder[name]);
  // A break after a bar that goes, goes; those after the bars move back.
  score.breaks = Object.fromEntries(Object.entries(score.breaks ?? {}).filter(([bar]) => Number(bar) < a || Number(bar) > b).map(([bar, kind]) => [Number(bar) > b ? Number(bar) - count : Number(bar), kind]));
  score.staves.forEach((staff, s) => {
    for (const name of STAFF_LISTS) if (staff[name]) staff[name] = shift(staff[name]);
    ossiasAfterDelete(staff, a, b, count);
    if (staff.voice || b + 1 >= bars) return;
    const [mine, was] = [ownAfter[s], ownBefore[s]];
    if (mine.key) {
      if (a === 0) {
        staff.key = mine.key.key;
        staff.mode = mine.key.mode;
      } else if (mine.key.key !== was.key.key && !staff.keys.some((m) => m.bar === a && m.pos === 0)) staff.keys = [...staff.keys, { bar: a, pos: 0, key: mine.key.key, mode: mine.key.mode }].sort((x, y) => x.bar - y.bar || x.pos - y.pos);
    }
    if (mine.time) {
      if (a === 0) staff.time = mine.time;
      else if (String(mine.time) !== String(was.time) && !staff.times.some((m) => m.bar === a)) staff.times = [...staff.times, { bar: a, time: mine.time }].sort((x, y) => x.bar - y.bar);
    }
    if (a === 0) staff.clef = clefsAfter[s];
    else if (clefsAfter[s] !== clefsBefore[s] && !(staff.clefs ?? []).some((c) => c.bar === a)) staff.clefs = [...(staff.clefs ?? []), { bar: a, clef: clefsAfter[s] }].sort((x, y) => x.bar - y.bar);
    if (staff.clefs && !staff.clefs.length) delete staff.clefs;
  });
  if (b + 1 < bars) {
    if (a === 0) {
      // What changes where the bars end is in force from the start now.
      score.key = own.key ?? after.key;
      score.time = own.time ?? after.time;
      if (own.time) score.timeParts = own.parts ?? null;
      score.tempo = own.tempo ?? after.tempo;
      // Bar 0's own change is the score's setting now; a length of its own stays its own (a pickup's place).
      score.changes = score.changes
        .map((c) => (c.bar === 0 ? Object.fromEntries(Object.entries(c).filter(([field]) => !["key", "mode", "time", "parts", "tempo"].includes(field))) : c))
        .filter((c) => Object.keys(c).length > 1);
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
  // What is kept as written (\\override …), then the stems and the beaming switched, a text span's words.
  let out = ev.before?.length ? `${ev.before.join(" ")} ` : "";
  out += ev.stemDir != null ? `${["\\stemDown", "\\stemNeutral", "\\stemUp"][Math.sign(ev.stemDir) + 1]} ` : "";
  if (ev.noAutoBeam != null) out += ev.noAutoBeam ? "\\autoBeamOff " : "\\autoBeamOn ";
  if (ev.spanStart) out += `\\override TextSpanner.bound-details.left.text = ${quote(ev.spanStart)} `;
  // An ottava line starts (or ends) before the note, its grace notes too.
  if (ev.ottava != null) out += `\\ottava #${ev.ottava} `;
  // Fingerings and string numbers: a chord's in it, by its note; the others after the value.
  const fingers = ev.rest || ev.pitches.some((p) => p.drum) ? [] : ev.fingers ?? [];
  const fingerText = (f) => (f.circled ? `\\${f.text}` : `${f.dir < 0 ? "^" : f.dir > 0 ? "_" : "-"}${f.text}`);
  // A post-event written with its \\tweak, as the text wrote it: -\\tweak color #red ->.
  const tw = (on, text) => {
    const t = (ev.tweaks ?? []).find((x) => x.on === on);
    if (!t) return text;
    return `${t.lead}${t.text} ${t.lead !== "-" && /^[-^_]/.test(text) ? text.slice(1) : text}`;
  };
  const onHead = (p) => (ev.pitches.length > 1 ? fingers.filter((f) => f.head === p.d && ev.pitches.find((q) => q.d === f.head) === p) : []);
  // Inside a chord, a note's string comes before its finger.
  const headMarks = (p) => onHead(p).sort((x, y) => Number(y.circled) - Number(x.circled)).map(fingerText).join("");
  const loose = fingers.filter((f) => !ev.pitches.some((p) => onHead(p).includes(f)));
  // A grace note with its fingering: c8-2, <c-1 e-3>8 — in braces, \grace { c8-2 }.
  const graceText = (g) => {
    const marks = g.fingers ?? [];
    const own = (p) => (g.pitches.length > 1 ? marks.filter((f) => f.head === p.d).map(fingerText).join("") : "");
    const heads = g.pitches.length > 1 ? `<${g.pitches.map((p) => bare(p) + own(p)).join(" ")}>` : bare(g.pitches[0]);
    const loose = marks.filter((f) => g.pitches.length === 1 || !g.pitches.some((p) => p.d === f.head));
    return heads + g.base + ".".repeat(g.dots) + loose.map(fingerText).join("");
  };
  if (ev.graces.length && !ev.rest) {
    const graces = ev.graces.map(graceText);
    out += `\\${ev.grace ?? "grace"} ${graces.length === 1 && !ev.graces[0].fingers?.length ? graces[0] : `{ ${graces.join(" ")} }`} `;
  }
  const after = !ev.rest && ev.afterGraces?.length ? ev.afterGraces.map(graceText) : null;
  if (after) out += `\\afterGrace ${ev.afterAt != null && ev.afterAt !== AFTER_GRACE_AT ? `${afterFraction(ev.afterAt)} ` : ""}`;
  out += ev.rest ? (ev.spacer ? "s" : "r") : ev.pitches.length > 1 ? `<${ev.pitches.map((p) => head(p) + headMarks(p)).join(" ")}>` : notes(ev.pitches);
  out += ev.base + ".".repeat(ev.dots);
  if (ev.tremolo && !ev.rest) out += `:${ev.tremolo}`;
  out += beam;
  if (ev.tie && !ev.rest) out += tw("tie", "~");
  if (ev.slurStart) out += tw("slur", "(");
  if (ev.slurEnd) out += ")";
  if (ev.phraseEnd && !ev.rest) out += "\\)";
  if (ev.phraseStart && !ev.rest) out += tw("phrase", "\\(");
  if (ev.dynamic) out += tw("dynamic", `\\${ev.dynamic}`);
  if (ev.hairpinEnd) out += tw("hairpinEnd", "\\!");
  if (ev.hairpin) out += tw("hairpin", HAIRPIN_WORDS.includes(ev.hairpinWords) ? `\\${ev.hairpinWords}` : ev.hairpin === "<" ? "\\<" : "\\>");
  // Each above (^) or below (_) when it was written so, else where the engraver puts it.
  for (const a of ev.arts) {
    const text = SCRIPTS[a] ?? "";
    const dir = ev.artDirs?.[a];
    out += tw(`art:${a}`, !text || !dir ? text : `${dir < 0 ? "^" : "_"}${text.startsWith("-") ? text.slice(1) : text}`);
  }
  out += loose.map((f) => (f.circled ? fingerText(f) : tw(`finger:${f.text}`, fingerText(f)))).join("");
  if (ev.chord) out += tw(`text:${ev.chord}`, `^${quote(ev.chord)}`);
  if (ev.fret && !ev.rest) out += `${ev.fretBelow ? "_" : "^"}\\markup \\fret-diagram ${quote(fretVerbose(ev.fret))}`;
  for (const t of ev.texts) out += tw(`text:${t.text}`, `${t.dir > 0 ? "_" : "^"}${wordsText(t)}`);
  if (ev.arpeggio && !ev.rest) out += tw("arpeggio", "\\arpeggio");
  if (ev.gliss && !ev.rest) out += tw("gliss", "\\glissando");
  // Let go before pressed again, when a note has both.
  if (ev.pedalOff) out += tw("pedalOff", "\\sustainOff");
  if (ev.pedalOn) out += tw("pedalOn", "\\sustainOn");
  // What LilyPond reads as commands after the note: a tie let ring or repeated, a text span, a breath.
  if (ev.lv && !ev.rest) out += tw("lv", "\\laissezVibrer");
  if (ev.repeatTie && !ev.rest) out += tw("repeatTie", "\\repeatTie");
  if (ev.spanEnd) out += "\\stopTextSpan";
  if (ev.spanStart != null) out += tw("spanStart", "\\startTextSpan");
  if (after) out += ` { ${after.join(" ")} }`;
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
  // A staff's words sung to a lower voice: a Lyrics line beside the staves, so inside << >>.
  let lyricsTo = false;
  // The music of the variables a \\partCombine names, written before the score.
  const partDefs = [];
  const music0 = firstMusic(score);
  const staves = staffLanes(score).map((s) => {
    const staff = score.staves[s];
    // A staff kept as written: its text, its notes numbered as the engraver numbers them there.
    if (staff.rawPart) return "";
    if (staff.raw != null) {
      items.push(...(staff.rawItems ?? []).map((drawn) => (drawn ? { kept: true } : { kept: true, spacer: true })));
      return staff.raw;
    }
    const upper = staffBars(score, staff, s);
    if (staff.chords || staff.figures) {
      // A line of chord names or a figured bass: its bars, the metre and the repeats left to the music's staves.
      for (const bar of upper) items.push(...bar.items);
      const texts = upper.map((bar, b) => oddStart(score, b, true) + bar.text + oddEnd(score, b));
      const kept = staff.withMore ? ` \\with { ${staff.withMore} }` : "";
      const line = staff.chords ? `\\new ChordNames${kept} \\chordmode` : `\\new FiguredBass${kept} \\figuremode`;
      return `${line} {\n  ${unfold ? playedOut(score, s, texts) : checked(texts)}\n}`;
    }
    // The other voices, each its bars: a bar is written in voices up to the
    // last that sounds there (or that the page writes in), those before it as they are.
    // Two parts on one staff: part II is written after part I, whole (see below).
    const partII = staff.combine ? laneOfVoice(score, s, 2) : -1;
    const others = partII >= 0 ? [] : voiceLanes(score, s).slice(1).map((lane) => ({ lane, bars: staffBars(score, score.staves[lane], lane) }));
    const voicesIn = (b) => {
      // A bar of cue notes keeps the rests of the part beside them.
      const cueBar = upper[b]?.events.length > 0 && upper[b].events.every((ev) => ev.cue);
      const shown = (o) => o.bars[b] && (sounding(o.bars[b].events) || open.some((x) => x.staff === o.lane && x.bar === b) || cueBar);
      let last = others.length - 1;
      while (last >= 0 && !shown(others[last])) last--;
      return others.slice(0, last + 1).map((o) => o.bars[b]);
    };
    const top = s === music0;
    // Words sung to a lower voice (\lyricsto): the staff's voices are written
    // whole, side by side, that voice named — LilyPond's lyrics follow one voice.
    const sungLane = lyricsLane(score, s);
    const spread = Boolean(staff.combine || staff.autoChange);
    const toVoice = !spread && !unfold && sungLane > s && versesOf(score.staves[sungLane]) > 0;
    if (toVoice) lyricsTo = true;
    // Under \compressMMRests, bars of rest side by side are written R1*n: gathered.
    const gathered = !toVoice && !spread && !unfold && score.compress ? restRuns(score, upper, voicesIn, repeats, (b) => (staff.ossias ?? []).some((o) => b >= o.bar && b < o.bar + o.bars)) : [];
    const fromItem = items.length;
    const bars = upper.map((bar, b) => {
      const broken = top && b > 0 ? { line: "\\break ", page: "\\pageBreak " }[(score.breaks ?? {})[b - 1]] ?? "" : "";
      const run = gathered[b];
      if (run === null) return null;
      if (run) {
        // One item: the run's first rest.
        items.push(bar.items[0]);
        return broken + changesText(score, s, b) + (top ? markText(score, b) : "") + run.text + (top ? jumpText(score, b + run.bars - 1) : "");
      }
      const voices = toVoice ? [] : voicesIn(b);
      items.push(...bar.items, ...voices.flatMap((v) => v.items));
      // An ossia over the bars ending here: its notes come after theirs, kept as written.
      const ossiaEnds = unfold ? [] : (staff.ossias ?? []).filter((o) => o.bar + o.bars - 1 === b);
      for (const o of ossiaEnds) items.push(...o.events.map((ev) => (ev.spacer ? { kept: true, spacer: true } : { kept: true })));
      const ossiaStarts = unfold ? [] : (staff.ossias ?? []).filter((o) => o.bar === b);
      // A voice drawn as nothing in the bar (spacers) is not counted among the voices:
      // past two, each then says which it is, so voice 3 stays voice 3.
      const named = voices.length > 1 && voices.some((v) => v.events.every((ev) => ev.rest && ev.spacer));
      const parts = [bar, ...voices].map((v, k) => `{ ${named ? `\\voice${VOICE_NAMES[k]} ` : ""}${v.text} }`);
      // A second voice of cue notes alone: a CueVoice beside the first, as \\cueDuring and its like write it.
      const cueOnly = (v) => v.events.every((ev) => ev.cue) && /^\\new CueVoice \{[^{}]*\}$/.test(v.text);
      const besideCue = voices.length === 1 && (cueOnly(voices[0]) || cueOnly(bar));
      const music = besideCue ? `<< ${[bar, voices[0]].map((v) => (cueOnly(v) ? v.text : `{ ${v.text} }`)).join(" ")} >>` : voices.length ? `<< ${parts.join(" \\\\ ")} >>` : bar.text;
      const bodyText = changesText(score, s, b) + (top ? markText(score, b) : "") + oddStart(score, b, voices.length > 0) + music + (top ? jumpText(score, b) : "") + oddEnd(score, b, b === upper.length - 1);
      return broken + ossiaStarts.map(() => "<< { ").join("") + bodyText + ossiaEnds.map((o) => ` } ${ossiaText(o)} >>`).join("");
    });
    let music = unfold ? playedOut(score, s, bars) : withRepeats(bars, repeats);
    if (partII >= 0) {
      // \\partCombine { part I } { part II }, or the variables it named, their music before the score.
      const middle = items.length;
      const lower = staffBars(score, score.staves[partII], partII);
      for (const bar of lower) items.push(...bar.items);
      markParts(score, items, fromItem, middle);
      const texts = lower.map((bar) => bar.text);
      const names = staff.combine.names ?? [];
      const part = (text, name) => {
        if (!name || unfold) return `{ ${text} }`;
        partDefs.push(`${name} = {\n  ${text.replace(/\n {4}/g, "\n  ")}\n}`);
        return `\\${name}`;
      };
      const [one, two] = [part(music, names[0]), part(unfold ? playedOut(score, partII, texts) : checked(texts), names[1])];
      music = `\\partCombine ${one}${one.startsWith("{") ? "\n    " : " "}${two}`;
    }
    // One voice over a piano's two staves: the lower staff's rests numbered after its notes.
    if (staff.autoChange) items.push(...echoItems(score, s));
    if (toVoice) {
      // The first voice keeps the bar's changes and the repeats; the others are its bars, one after another.
      const lower = others.map((o) => {
        for (const bar of o.bars) items.push(...bar.items);
        const voice = voiceOf(score, o.lane);
        const named = o.lane === sungLane ? `\\new Voice = ${quote(lyricsName(score, s))}` : "\\new Voice";
        return `${named} { \\voice${VOICE_NAMES[voice - 1]} ${checked(o.bars.map((bar) => bar.text))} }`;
      });
      music = `<< { \\voiceOne ${music} }\n    ${lower.join("\n    ")} >>`;
    }
    const lastRepeat = !unfold && repeats.find((r) => r.endings.length === 0 && r.to === bars.length - 1);
    const name = staff.name ? `instrumentName = ${quote(staff.name)} ` : "";
    const short = staff.short ? `shortInstrumentName = ${quote(staff.short)} ` : "";
    const midi = staff.instrument && !staff.drums ? `midiInstrument = ${quote(staff.instrument)} ` : "";
    const tempo = s === music0 && score.tempo && (score.tempo.text || score.tempo.bpm) ? ` ${tempoText(score.tempo)}` : "";
    const clef = clefText(staff.clef);
    const time = staff.time ?? score.time;
    // The metre a staff draws beside the others' (\\set Staff.timeSignatureFraction), its bars as long as theirs.
    const shown = staff.shownTime ? ` \\set Staff.timeSignatureFraction = ${staff.shownTime[0]}/${staff.shownTime[1]}` : "";
    // The first bar a \\partial made its own length (see oddWriting): a pickup, as every staff writes one.
    const odd0 = score.pickup > 0 ? null : oddWriting(score, 0);
    const first = score.pickup > 0 ? score.pickup : odd0?.kind === "partial" && odd0.pos === 0 ? odd0.ticks : 0;
    const partial = (first > 0 ? ` \\partial ${pickupText(first)}` : "") + shown;
    // What its \\with says more, kept as written.
    const settings = name + short + midi + (staff.withMore ? `${staff.withMore} ` : "");
    // A piece that ends on a repeat's end keeps its :|. sign, not a final bar.
    const ending = lastRepeat ? "" : ' \\bar "|."';
    // Written pitch: a transposing instrument's staff, key and all, where it is read.
    const moved = written ? transpositionOf(staff) : null;
    const brace = moved ? `\\transpose c ${moved} {` : "{";
    // A drum staff: its strokes in \\drummode, with no clef and no key.
    const auto = staff.autoChange;
    const piano = auto && (auto.piano || settings) ? `\\new PianoStaff ${settings ? `\\with { ${settings}} ` : ""}` : "";
    const opening = auto
      ? `${piano}\\autoChange ${auto.split ? `${auto.split} ` : ""}{\n  \\key ${keyText(keyOf(score, s), staffKeyAt(score, s, 0).mode)} \\time ${timeText(score, time)}${partial}${tempo}`
      : staff.drums
      ? `\\new DrumStaff ${settings ? `\\with { ${settings}} ` : ""}\\drummode {\n  \\time ${timeText(score, time)}${partial}${tempo}`
      : `\\new ${staff.tab ? "TabStaff" : "Staff"} ${staff.id ? `= ${quote(staff.id)} ` : ""}${settings ? `\\with { ${settings}} ` : ""}${brace}\n  ${staff.tab ? "" : `\\clef ${clef} `}\\key ${keyText(keyOf(score, s), staffKeyAt(score, s, 0).mode)} \\time ${timeText(score, time)}${partial}${tempo}`;
    let out = `${opening}\n  ${music.replace(/\n {4}/g, "\n  ")}${ending}\n}`;
    // Each verse a line under the one before; sung to a lower voice, a Lyrics line that follows it.
    if (toVoice) {
      const sung = score.staves[sungLane];
      for (let verse = 1; verse <= versesOf(sung); verse++) out += `\n\\new Lyrics \\lyricsto ${quote(lyricsName(score, s))} { ${lyricText(sung, verse)} }`;
    } else if (sungLane === s && !spread) {
      for (let verse = 1; verse <= versesOf(staff); verse++) out += `\n\\addlyrics { ${lyricText(staff, verse)} }`;
    }
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
        if (staves[n]) out.push(staves[n]);
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
  const shownStaves = staves.filter(Boolean);
  const body = shownStaves.length > 1 || group || lyricsTo ? `${group ? group + " " : ""}<<\n${indent(nest(0, staves.length - 1, groups))}\n>>` : shownStaves[0];
  // Bars of rest gathered on every staff: a part's long rests, as one bar.
  const gathering = score.compress ? "\\compressMMRests " : "";
  // The variables a staff kept as written uses, as they were written.
  const allDefs = [...(score.defs ?? []), ...partDefs];
  const defs = allDefs.length ? `${allDefs.join("\n")}\n` : "";
  const source = pageText(score) + defs + (header ? `\\header { ${header} }\n` : "") + gathering + body + "\n";
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
function restRuns(score, upper, voicesIn, repeats, ossiaOver = () => false) {
  const edges = new Set();
  for (const r of repeats) {
    let next = r.to + 1;
    edges.add(r.from).add(next);
    for (const len of r.endings) edges.add((next += len));
  }
  const restOf = (b) => {
    if ((b === 0 && score.pickup > 0) || isOddBar(score, b) || voicesIn(b).length || ossiaOver(b)) return null;
    const events = upper[b].events;
    if (!events.length || !events.every((ev) => isBareRest(ev) && !ev.spacer)) return null;
    const value = spellDuration(barLength(score, b));
    return value.length === 1 ? `R${value[0].base}${".".repeat(value[0].dots)}` : null;
  };
  const quiet = (b) => !edges.has(b) && !isOddBar(score, b - 1) && !score.staves.some((_, s) => changesText(score, s, b)) && !markText(score, b) && !(score.breaks ?? {})[b - 1] && !jumpText(score, b - 1);
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

const clefText = (clef) => (CLEFS.includes(clef) ? (/[_^]/.test(clef) ? `"${clef}"` : clef) : "treble");
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
  const c = changeAt(score, b);
  const words = c?.words ? `\\mark ${markWords(c.words)} ` : "";
  return ({ letter: "\\mark \\default ", segno: "\\segnoMark ", coda: "\\codaMark " }[c?.mark] ?? "") + words;
}

/** A mark's words: bold, as a mark's are, unless they say otherwise. */
const markWords = (w) => (w.bold && !w.italic ? quote(w.text) : wordsText(w));

/** A mark inside a bar, `{ mark | words | jump }`, as LilyPond writes it. */
function midMarkText(m) {
  if (m.jump) return m.jump === "fine" ? "\\fine" : `\\jump ${quote(JUMPS[m.jump])}`;
  if (m.words) return `\\mark ${markWords(m.words)}`;
  return { letter: "\\mark \\default", segno: "\\segnoMark", coda: "\\codaMark" }[m.mark] ?? "";
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
  if (clef && !drums && !score.staves[s].tab) parts.push(`\\clef ${clefText(clef.clef)}`);
  const c = changeAt(score, b);
  const key = drums ? null : keyChanges(score, s).find((m) => m.bar === b && m.pos === 0);
  if (key) parts.push(`\\key ${keyText(key.key, key.mode)}`);
  // A metre whose \\time was written inside the bar before: not again.
  const time = oddWriting(score, b - 1)?.kind === "time" && !score.staves[s].times ? null : timeChanges(score, s).find((m) => m.bar === b);
  if (time) parts.push(`\\time ${time.parts?.length > 1 && time.parts.reduce((x, y) => x + y, 0) === time.time[0] ? time.parts.join("+") : time.time[0]}/${time.time[1]}`);
  if (c?.tempo && s === firstMusic(score)) parts.push(tempoText(c.tempo));
  // A bar its \\partial makes as long as it is, from its start: the first staff writes it.
  const odd = s === firstMusic(score) ? oddWriting(score, b) : null;
  if (odd?.kind === "partial" && odd.pos === 0) parts.push(`\\partial ${pickupText(odd.ticks)}`);
  // After a bar of its own length, its end wrote it.
  if (c?.line && !isOddBar(score, b - 1)) parts.unshift(`\\bar "${c.line}"`);
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
    if (open >= 0 && (barAt(score, at[i]) !== barAt(score, at[open]) || tupletGroup(ev) !== tupletGroup(staff.events[open]) || (!ev.rest && ev.base < 8))) open = -1;
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
  if (staff.voice || staff.chords || staff.figures) return [];
  // The tempo and the marks inside bars: the first staff's to write.
  const top = s === firstMusic(score);
  // A \\time or a \\partial inside a bar, where it was (see oddWriting): the first staff's.
  const odds = [];
  for (let b = 0; top && b < barsOf(score); b++) {
    const odd = isOddBar(score, b) ? oddWriting(score, b) : null;
    if (!odd || odd.pos === 0) continue;
    const text = odd.kind === "partial" ? `\\partial ${pickupText(odd.ticks)}` : `\\time ${odd.parts?.length > 1 ? odd.parts.join("+") : odd.time[0]}/${odd.time[1]}`;
    odds.push({ bar: b, pos: odd.pos, order: -1, text });
  }
  const tempos = top ? (score.midTempos ?? []).map((m) => ({ bar: m.bar, pos: m.pos, order: 2, text: tempoText(m.tempo) })) : [];
  const marks = top ? (score.midMarks ?? []).map((m) => ({ bar: m.bar, pos: m.pos, order: 3, text: midMarkText(m) })) : [];
  if (staff.drums) return [...odds, ...tempos, ...marks].sort((x, y) => x.bar - y.bar || x.pos - y.pos || x.order - y.order);
  const keys = keyChanges(score, s).filter((m) => m.pos > 0).map((m) => ({ bar: m.bar, pos: m.pos, order: 1, text: `\\key ${keyText(m.key, m.mode)}` }));
  const clefs = staff.tab ? [] : (staff.midClefs ?? []).map((c) => ({ bar: c.bar, pos: c.pos, order: 0, text: `\\clef ${clefText(c.clef)}` }));
  return [...odds, ...clefs, ...keys, ...tempos, ...marks].sort((x, y) => x.bar - y.bar || x.pos - y.pos || x.order - y.order);
}

/**
 * What starts a bar of its own length: \\cadenzaOn, for a cadenza from its
 * start (or one beside other voices, which start with it). One that starts
 * later in its bar is written before its note (staffBars).
 */
function oddStart(score, b, whole) {
  const at = changeAt(score, b)?.cadenza;
  return at != null && (at === 0 || whole) ? "\\cadenzaOn " : "";
}

/**
 * What ends a bar of its own length: \\cadenzaOff, or a bar line where its
 * metre would go on — the next bar's own when it has one (written here, not
 * at its start). The piece's last bar ends on its final bar line (`final`).
 */
function oddEnd(score, b, final = false) {
  const c = changeAt(score, b);
  if (!c?.len) return "";
  const line = changeAt(score, b + 1)?.line;
  // A bar a \\time or a \\partial made: they end it (see oddWriting).
  if (oddWriting(score, b)) return line ? ` \\bar "${line}"` : "";
  if (c.cadenza != null) return ` \\cadenzaOff${line ? ` \\bar "${line}"` : ""}`;
  return final && !line ? "" : ` \\bar "${line ?? "|"}"`;
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
  let inner = null;
  let cue = false;
  // The scale of the \\scaleDurations run open, "n/d", or null.
  let scaled = null;
  // The bar whose cadenza has been opened.
  let cadenzaIn = -1;
  // The staff the notes are drawn on: each bar starts and ends on its own.
  const own = score.staves[upperOf(score, s)].id;
  let drawnOn = null;
  const change = (id) => current.parts.push(`\\change Staff = ${quote(id ?? own)}`);
  const close = () => {
    // A \\time that ends its bar where it is written (see oddWriting): before the bar line.
    while (next < mids.length && mids[next].bar === bars.length && mids[next].order === -1) current.parts.push(mids[next++].text);
    if (drawnOn !== null) change(null);
    drawnOn = null;
    if (inner !== null) current.parts.push("}");
    inner = null;
    if (open !== null) current.parts.push("}");
    open = null;
    if (scaled !== null) current.parts.push("}");
    scaled = null;
    if (cue) current.parts.push("}");
    cue = false;
    bars.push({ text: current.parts.join(" "), items: current.items, events: current.events });
    current = { parts: [], items: [], events: [] };
  };
  staff.events.forEach((ev, i) => {
    current.items.push({ staff: s, index: i });
    current.events.push(ev);
    // The tuplet it is in (the outer one, when they nest), and the one inside that.
    const tid = tupletGroup(ev);
    const iid = ev.tuplet?.outer ? ev.tuplet.id : null;
    // A run of cue notes ends: its tuplets close inside it.
    if (cue && !ev.cue) {
      if (inner !== null) current.parts.push("}");
      if (open !== null) current.parts.push("}");
      inner = null;
      open = null;
      current.parts.push("}");
      cue = false;
    }
    if (inner !== null && (iid !== inner || tid !== open)) {
      current.parts.push("}");
      inner = null;
    }
    if (open !== null && tid !== open) {
      current.parts.push("}");
      open = null;
    }
    const b = bars.length;
    const pos = t - barStart(score, b);
    // One no event starts at is written before the first after it, the next bar's first at the latest.
    while (next < mids.length && (mids[next].bar < b || (mids[next].bar === b && mids[next].pos <= pos + 1e-6))) current.parts.push(mids[next++].text);
    // A run of cue notes: in a CueVoice of their own, around their tuplets.
    if (ev.cue && !cue) {
      if (inner !== null) current.parts.push("}");
      if (open !== null) current.parts.push("}");
      inner = null;
      open = null;
      current.parts.push("\\new CueVoice {");
      cue = true;
    }
    // A cadenza that starts inside its bar: before its first note (a staff's first voice writes it).
    const cadenza = changeAt(score, b)?.cadenza;
    if (cadenza > 0 && !staff.voice && !staff.chords && !staff.figures && cadenzaIn !== b && pos >= cadenza - 1e-6) {
      current.parts.push("\\cadenzaOn");
      cadenzaIn = b;
    }
    // A run of notes scaled alike (\\scaleDurations n/d): in braces of its own, around its tuplets.
    const scale = ev.scale ? `${ev.scale[0]}/${ev.scale[1]}` : null;
    if (scale !== scaled) {
      if (inner !== null) current.parts.push("}");
      if (open !== null) current.parts.push("}");
      inner = null;
      open = null;
      if (scaled !== null) current.parts.push("}");
      if (scale !== null) current.parts.push(`\\scaleDurations ${scale} {`);
      scaled = scale;
    }
    if (tid !== null && open === null) {
      const around = ev.tuplet.outer ?? ev.tuplet;
      current.parts.push(`\\tuplet ${around.n}/${around.d} {`);
      open = tid;
    }
    if (iid !== null && inner === null) {
      current.parts.push(`\\tuplet ${ev.tuplet.n}/${ev.tuplet.d} {`);
      inner = iid;
    }
    const on = crossOf(score, s, ev);
    if (on !== drawnOn) change(on);
    drawnOn = on;
    current.parts.push(staff.chords ? chordText(ev) : staff.figures ? figureText(ev) : eventText(ev, beams[i]));
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
  refuseRawBars(score);
  if (at === 0 && score.pickup > 0) throw new Error("the pickup starts the piece: bars go after it");
  const t = barStart(score, at);
  if (score.staves.some((staff) => t > lengthOf(staff))) throw new Error("no such bar");
  // What changes from bar `at` moves along: the new bars keep the metre before them.
  for (const c of score.changes ?? []) if (c.bar >= at) c.bar += count;
  for (const [holder, name] of barLists(score)) for (const m of holder[name]) if (m.bar >= at) m.bar += count;
  const ticks = barStart(score, at + count) - t;
  // An ossia the bars go into grows by them, spacers where they go; one after them moves along.
  for (const staff of score.staves) {
    for (const o of staff.ossias ?? []) {
      if (o.bar >= at) o.bar += count;
      else if (at < o.bar + o.bars) {
        const into = t - barStart(score, o.bar);
        const k = starts({ events: o.events }).indexOf(into);
        if (k >= 0) o.events.splice(k, 0, ...rests(score, t, ticks, true));
        o.bars += count;
      }
    }
  }
  for (const staff of score.staves) {
    const i = t === lengthOf(staff) ? staff.events.length : eventAt(staff, t);
    if (i < 0) throw new Error("bars must start at a bar line");
    staff.events.splice(i, 0, ...laneRests(score, staff, t, ticks));
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
  // A closed hi-hat (+ over it) and a half-open one: the hi-hat's keys, told apart by their sign.
  { name: "hhc", d: 10, key: 42 }, { name: "hhho", d: 10, key: 46 },
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

/** Whether lane `s` is a tablature's (\\new TabStaff): its notes are drawn as frets, it has no clef. */
export function isTab(score, s) {
  return Boolean(score.staves[upperOf(score, s)]?.tab);
}

/** Whether lane `s` is a drum staff's. */
export function isDrums(score, s) {
  return Boolean(score.staves[upperOf(score, s)]?.drums);
}

function refuseDrums(score, s) {
  if (isDrums(score, s)) throw new Error("A drum staff has drums, not pitches: the drum buttons write and change them");
  if (isChords(score, s)) throw new Error(CHORD_LINE_NOTES);
  if (isFigures(score, s)) throw new Error(FIGURE_LINE_NOTES);
}

// ---- Lines of chord names ---------------------------------------------------------
//
// `\new ChordNames \chordmode { c2:m7 f:7 }`: a staff of its own (`staff.chords`)
// whose events are rests that last as long as a chord holds, each its symbol
// (`ev.chord`, "Cm7"), "N.C." (written `r`), or none (`s`). `ev.chordmode`
// keeps a chord as the source wrote it (`c:m7`), written back as it was
// until the chord is changed. The music's metre, pickup and repeats are the
// other staves': the line follows them.

const CHORD_LINE_NOTES = "A line of chord names holds chord symbols, not notes: select a beat and type one (K)";

/** Whether lane `s` is a line of chord names. */
export function isChords(score, s) {
  return Boolean(score.staves[upperOf(score, s)]?.chords);
}

/** The first staff of music (not a line of chord names): the one that writes the marks, the tempo and the breaks. */
function firstMusic(score) {
  return staffLanes(score).find((u) => !score.staves[u].chords && !score.staves[u].figures) ?? 0;
}

const CHORD_ALTERS = { "#": 1, "♯": 1, b: -1, "♭": -1, "": 0 };
// A symbol's quality and the \chordmode modifier it is: "m7" is ":m7".
const CHORD_KINDS = [
  ["", ""], ["m", "m"], ["6", "6"], ["m6", "m6"], ["7", "7"], ["9", "9"], ["11", "11"], ["13", "13"],
  ["maj7", "maj7"], ["maj9", "maj9"], ["m7", "m7"], ["m9", "m9"], ["m11", "m11"], ["dim", "dim"], ["dim7", "dim7"],
  ["aug", "aug"], ["aug7", "aug7"], ["m7b5", "m7.5-"], ["sus2", "sus2"], ["sus4", "sus4"], ["7sus4", "sus4.7"],
  ["6/9", "6.9"], ["add9", "5.9"], ["m(maj7)", "m7+"], ["5", "1.5"],
];
// Other ways people write them.
const CHORD_SAME = { min: "m", "-": "m", M7: "maj7", "Δ": "maj7", "Δ7": "maj7", "△": "maj7", "△7": "maj7", "-7": "m7", min7: "m7", "°": "dim", "°7": "dim7", "+": "aug", "+7": "aug7", "ø": "m7b5", "ø7": "m7b5", sus: "sus4", 69: "6/9", mMaj7: "m(maj7)", "m(Δ7)": "m(maj7)" };

/** A note name of \chordmode ("bes", "fis") from a letter and its sign ("Bb", "F#"). */
function chordRoot(letter, sign) {
  return spellPitch("CDEFGAB".indexOf(letter), CHORD_ALTERS[sign] ?? 0);
}

/**
 * A chord symbol as \chordmode writes it, without its duration: "Cm7" is
 * "c:m7", "Bbmaj7/D" "bes:maj7/d", "C7b9" "c:7.9-". Throws on one it cannot write.
 */
export function chordmodeOf(symbol) {
  const text = String(symbol ?? "").trim();
  const m = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/.exec(text);
  const refuse = () => new Error(`“${text}” is not a chord the line of chord names can write: try C, Am7, F7, Bbmaj7, G7/B, Dm7b5, Csus4`);
  if (!m) throw refuse();
  const rest = m[3];
  // The quality, then any altered fifths, ninths, elevenths, thirteenths: C7b9#11.
  const found = /^(.*?)((?:[#b♯♭](?:5|9|11|13))*)$/.exec(rest);
  const quality = CHORD_SAME[found[1]] ?? found[1];
  const kind = CHORD_KINDS.find(([name]) => name === quality);
  if (!kind) throw refuse();
  const alters = [...found[2].matchAll(/([#b♯♭])(\d+)/g)].map(([, sign, n]) => `${n}${CHORD_ALTERS[sign] > 0 ? "+" : "-"}`);
  const mods = [kind[1], ...alters].filter(Boolean).join(".");
  return chordRoot(m[1], m[2]) + (mods ? `:${mods}` : "") + (m[4] ? `/${chordRoot(m[4], m[5])}` : "");
}

/** A \chordmode chord (its duration left out or not) as its symbol: "c:m7" is "Cm7"; null for one this does not name. */
export function symbolOfChordmode(written) {
  const m = /^([a-g])((?:is|es|s)*)[',]*(?:\d+\.*)?(?::([0-9a-z.+\-^]*))?(?:\/([a-g])((?:is|es|s)*))?$/.exec(String(written ?? "").trim());
  if (!m) return null;
  const sign = (suffix) => ({ is: "#", isis: "##", es: "b", s: "b", eses: "bb", ses: "bb" })[suffix] ?? "";
  const name = (letter, suffix) => letter.toUpperCase() + sign(suffix);
  // The quality, as the longest modifier it starts with, and the alterations after it.
  const mods = m[3] ?? "";
  const kinds = [...CHORD_KINDS].filter(([, mod]) => mods === mod || (mod && mods.startsWith(`${mod}.`)) || !mod).sort((x, y) => y[1].length - x[1].length);
  for (const [quality, mod] of kinds) {
    const rest = mod ? mods.slice(mod.length) : mods ? `.${mods}` : "";
    const alters = rest.split(".").filter(Boolean);
    if (!alters.every((a) => /^(5|9|11|13)[+-]$/.test(a))) continue;
    const altered = alters.map((a) => `${a.endsWith("+") ? "#" : "b"}${a.slice(0, -1)}`).join("");
    return name(m[1], m[2]) + quality + altered + (m[4] ? `/${name(m[4], m[5])}` : "");
  }
  return null;
}

/** A \chordmode chord moved by `steps` letters and `semitones`: its root and its bass, the rest as written. */
function transposeChordmode(written, steps, semitones) {
  const move = (letter, suffix) => {
    const alter = { is: 1, isis: 2, es: -1, s: -1, eses: -2, ses: -2 }[suffix] ?? 0;
    const p = transposePitch({ d: "cdefgab".indexOf(letter), alter }, steps, semitones);
    return spellPitch(mod7(p.d), p.alter);
  };
  return written.replace(/^([a-g])((?:is|es|s)*)/, (_, l, s) => move(l, s)).replace(/\/([a-g])((?:is|es|s)*)/, (_, l, s) => `/${move(l, s)}`);
}

/** A chord's name as ChordNames prints it ("BaccidentalFlat△"), as a symbol people type: "Bbmaj7". */
function symbolOfName(name) {
  return String(name ?? "").replace(/accidentalFlat/g, "b").replace(/accidentalSharp/g, "#").replace(/△/g, "maj").replace(/°/g, "dim").replace(/ø/g, "m7b5").replace(/\s+/g, "");
}

/** What a line of chord names writes for one of its events: the chord, "r" for N.C., "s" for none. */
function chordText(ev) {
  const value = ev.base + ".".repeat(ev.dots);
  const written = ev.chordmode ?? (ev.chord === "N.C." ? "r" : ev.chord ? chordmodeOf(ev.chord) : "s");
  // The duration goes after the root: c2:m7.
  const root = /^([a-g](?:is|es|s)*[',]*|[rs])/.exec(written)?.[0] ?? written;
  return root + value + written.slice(root.length);
}

/** The time of the beat after `t` (ticks): a quarter in 4/4, an eighth in 6/8. */
export function nextBeat(score, t) {
  const b = barAt(score, t);
  const beat = WHOLE / timeAt(score, b)[1];
  const from = barStart(score, b);
  return from + (Math.floor((t - from) / beat + 1e-9) + 1) * beat;
}

/** Whether an item of `toLilyPond` is drawn: a spacer is not, nor a beat of a line of chord names with no chord. */
export function isDrawn(score, item) {
  // A note of what is kept as written (an ossia's): drawn unless a spacer.
  if (item.kept) return !item.spacer;
  // A part's note drawn once for both parts, an \\autoChange's rest where its note is.
  if (item.hidden) return false;
  const ev = score.staves[item.staff]?.events[item.index];
  const line = score.staves[item.staff];
  return Boolean(ev) && !ev.spacer && !(line.chords && !ev.chord) && !(line.figures && !ev.figureRaw && !/[^_ ]/.test(ev.figure ?? ""));
}

/** The line of chord names right over the staff of lane `s` (or that lane itself when it is one), or −1. */
export function chordLineOver(score, s) {
  if (isChords(score, s)) return upperOf(score, s);
  const lanes = staffLanes(score);
  const above = lanes[staffNumber(score, s) - 1];
  return above != null && score.staves[above].chords ? above : -1;
}

/**
 * The chord from `t` (ticks) on lane `s`, a line of chord names: the line is
 * cut there, the chord before it holding up to it, this one up to the next.
 * Empty text takes it away; "N.C." is no chord, said.
 */
export function setChordAt(score, s, t, text) {
  const staff = score.staves[s];
  if (!staff?.chords) throw new Error("not a line of chord names");
  if (t < 0 || t >= lengthOf(staff)) throw new Error("no beat there");
  const symbol = String(text ?? "").trim();
  if (symbol && !/^n\.?c\.?$/i.test(symbol)) chordmodeOf(symbol);
  if (cut(score, staff, t) !== t) throw new Error("a chord does not start inside a tuplet");
  setChordSymbol(score, s, eventAt(staff, t), symbol);
  tidy(score, staff);
}

// ---- A figured bass -------------------------------------------------------------------
//
// `\new FiguredBass \figuremode { <6 4>4 <7+> s2 }`: a line under the bass,
// a lane of its own (`staff.figures`) whose events are rests as long as a
// figure holds, each its figures as written between < > (`ev.figure`, "6 4").

const FIGURE_LINE_NOTES = "A figured bass holds figures, not notes: select a beat and type them";

/** Whether lane `s` is a figured bass. */
export function isFigures(score, s) {
  return Boolean(score.staves[upperOf(score, s)]?.figures);
}

/** Figures as `\figuremode` reads them between < >: "6 4", "7+", "6\\", "_ 5-", "[6]". */
function figuresOf(text) {
  const figures = String(text ?? "").trim().replace(/^<|>$/g, "").trim().split(/\s+/).filter(Boolean);
  if (!figures.length || figures.length > 4 || !figures.every((f) => /^(_|\[?(\d{1,2})?[-+!]?[\\/]?\]?)$/.test(f) && f !== "[]" && f !== "")) {
    throw new Error(`“${String(text ?? "").trim()}” is not figures a figured bass can write: try 6, 6 4, 7, 4 2, 7+, 5-, _ 6`);
  }
  return figures.join(" ");
}

/** What a figured bass writes for one of its events. */
function figureText(ev) {
  const value = ev.base + ".".repeat(ev.dots);
  return ev.figure ? `<${ev.figure}>${value}` : ev.figureRaw ? `${ev.figureRaw}${value}` : `s${value}`;
}

/** The figured bass right under the staff of lane `s` (or that lane itself when it is one), or −1. */
export function figureLineUnder(score, s) {
  if (isFigures(score, s)) return upperOf(score, s);
  const lanes = staffLanes(score);
  const below = lanes[staffNumber(score, s) + 1];
  return below != null && score.staves[below].figures ? below : -1;
}

/** The figures from `t` on lane `s`, a figured bass, the line cut there; empty text takes them away. */
export function setFigureAt(score, s, t, text) {
  const staff = score.staves[s];
  if (!staff?.figures) throw new Error("not a figured bass");
  if (t < 0 || t >= lengthOf(staff)) throw new Error("no beat there");
  const figure = String(text ?? "").trim() ? figuresOf(text) : "";
  if (cut(score, staff, t) !== t) throw new Error("figures do not start inside a tuplet");
  const ev = staff.events[eventAt(staff, t)];
  delete ev.figureRaw;
  if (figure) ev.figure = figure;
  else delete ev.figure;
  tidy(score, staff);
}

/** A figured bass under the staff of lane `s`, empty: answers its lane. */
export function addFigureStaff(score, s = 0) {
  const u = upperOf(score, s);
  if (!score.staves[u]) throw new Error("no such staff");
  if (score.staves[u].figures || score.staves[u].chords) throw new Error("a figured bass goes under a staff of music");
  if (figureLineUnder(score, u) >= 0) throw new Error("this staff has a figured bass already");
  const at = u + voiceLanes(score, u).length;
  const n = staffNumber(score, u) + 1;
  score.staves.splice(at, 0, { name: "", short: "", instrument: "", clef: "bass", figures: true, events: rests(score, 0, lengthOf(score.staves[u])) });
  score.groups = (score.groups ?? []).map((g) => ({ ...g, first: g.first >= n ? g.first + 1 : g.first, last: g.last >= n ? g.last + 1 : g.last }));
  shiftMetaLanes(score.meta, at, 1);
  return at;
}

/** The tuplets of a line of chord names or figures, by the parse's: each the model's own id. */
function lineTuplets() {
  const ids = new Map();
  return (ev) => {
    const [tid, n, d] = ev.tuplet;
    if (!ids.has(tid)) ids.set(tid, newId());
    return { id: ids.get(tid), n, d };
  };
}

/** A figured bass from its parse: each figure a rest as long as it holds, its figures as written. */
function figureLine(score, staff, unsupported) {
  const out = { name: "", short: "", instrument: "", clef: "bass", figures: true, events: [] };
  const tuplet = lineTuplets();
  for (const ev of staff.events) {
    ev.unsupported.forEach((u) => unsupported.add(u));
    if (ev.k !== "Note" && ev.k !== "Rest") continue;
    if (ev.tuplet_outer) unsupported.add("a tuplet in a tuplet in a figured bass");
    const ticks = ev.ticks * Math.max(1, ev.count ?? 1);
    const at = lengthOf(out);
    let figure = "";
    let raw = "";
    try {
      figure = ev.figure_text ? figuresOf(ev.figure_text) : "";
    } catch {
      // Figures the tools do not write (an accidental alone, five figures…): kept as written.
      raw = ev.figure_text;
    }
    const read = makeEvent({ base: ev.base, dots: ev.dots, ...(figure ? { figure } : {}), ...(raw ? { figureRaw: raw } : {}), ...(ev.tuplet ? { tuplet: tuplet(ev) } : {}) });
    if (!ev.tuplet && (at + ticks > nextBarLine(score, at) + 1e-6 || notated(ev.base, ev.dots) !== ticks)) out.events.push(...pieces(score, read, at, ticks, "whole"));
    else out.events.push(read);
  }
  return out;
}

// ---- Chord diagrams ---------------------------------------------------------------------
//
// `^\markup \fret-diagram "6-x;5-3;4-2;3-o;2-1;1-o;"` over a note: `ev.fret`
// is its shape as eui-score keeps it, each string from the low E ("x;3;2;o;1;o;"),
// and a barre after it ("|6-1-1"); `ev.fretBelow` when it stands under the staff.

const FRET_MARK = "\u0001fret:";

/** A shape typed as "x32010", "x;3;2;0;1;0" or "x 3 2 0 1 0", low E first: its spec. */
export function fretSpec(text) {
  const typed = String(text ?? "").trim().toLowerCase();
  const items = /^[xo0-9]{6}$/.test(typed) ? [...typed] : typed.split(/[;\s,]+/).filter(Boolean);
  const ok = items.length === 6 && items.every((f) => /^(x|o|\d{1,2})$/.test(f) && (!/^\d+$/.test(f) || Number(f) <= 24));
  if (!ok) throw new Error(`“${String(text ?? "").trim()}” is not a guitar chord: six strings from the low E, x not played, 0 open, as x32010 for C`);
  return items.map((f) => (f === "0" ? "o" : f)).join(";") + ";";
}

/** A spec as people type it: "x32010" when every fret is one digit. */
export function fretText(spec) {
  const [frets, barre] = String(spec ?? "").split("|");
  const items = frets.split(";").filter(Boolean).map((f) => (f === "o" ? "0" : f));
  const typed = items.every((f) => f.length === 1) ? items.join("") : items.join(" ");
  return barre ? `${typed} | barre ${barre}` : typed;
}

/** `\fret-diagram`'s own words for a spec: each string 6 to 1, and the barre. */
function fretVerbose(spec) {
  const [frets, barre] = String(spec).split("|");
  const items = frets.split(";").filter(Boolean).map((f, k) => `${6 - k}-${f}`);
  return (barre ? `c:${barre};` : "") + items.join(";") + ";";
}

/** A chord diagram over note `i` (a shape, see fretSpec); empty takes it away. */
export function setFretDiagram(score, s, i, text) {
  const ev = pitchedNote(score, s, i);
  if (!String(text ?? "").trim()) {
    delete ev.fret;
    delete ev.fretBelow;
    return;
  }
  ev.fret = fretSpec(text);
}

/** Lanes `at` and after moved by `by` in what the meta line keys by lane: velocities, curves, the mixer's tracks, the synthesizers and own SoundFonts (#391). */
function shiftMetaLanes(meta, at, by) {
  if (!meta) return;
  // An audio track's ("audio-1", #390) is no staff's lane: it stays as it is.
  const moved = (lane) => (!/^\d+$/.test(String(lane)) ? lane : Number(lane) >= at ? Number(lane) + by : Number(lane));
  if (meta.velocity) meta.velocity = Object.fromEntries(Object.entries(meta.velocity).map(([id, v]) => [[moved(id.split(":")[0]), ...id.split(":").slice(1)].join(":"), v]));
  if (meta.cc) meta.cc = Object.fromEntries(Object.entries(meta.cc).map(([lane, v]) => [moved(lane), v]));
  if (meta.mixer?.tracks) meta.mixer.tracks = Object.fromEntries(Object.entries(meta.mixer.tracks).map(([lane, v]) => [moved(lane), v]));
  for (const name of ["synth", "soundfont"]) if (meta[name]) meta[name] = Object.fromEntries(Object.entries(meta[name]).map(([lane, v]) => [moved(lane), v]));
}

/** A line of chord names over the staff of lane `s`, empty: answers its lane. */
export function addChordStaff(score, s = 0) {
  const u = upperOf(score, s);
  if (!score.staves[u]) throw new Error("no such staff");
  if (score.staves[u].chords) throw new Error("this is a line of chord names already");
  const n = staffNumber(score, u);
  score.staves.splice(u, 0, { name: "", short: "", instrument: "", clef: "treble", chords: true, events: rests(score, 0, lengthOf(score.staves[u])) });
  score.groups = (score.groups ?? []).map((g) => ({ ...g, first: g.first >= n ? g.first + 1 : g.first, last: g.last >= n ? g.last + 1 : g.last }));
  shiftMetaLanes(score.meta, u, 1);
  return u;
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
  out.systemsPerPage = null;
  out.marks = null;
  return out;
}

// ---- Headers and footers, systems per page (#388) ------------------------------------------
//
// `score.paper.systemsPerPage` (null: as many as fit) and `score.paper.marks`
// {oddHeader, evenHeader, oddFooter, evenFooter}, each null or a line: its
// cells, as LilyPond's \\fill-line spreads them — one is centred, two stand
// at the ends, three are left, centre and right — each cell words with
// fields in braces, {title}, {composer}, {page}…; or `{ raw }`, a markup
// this does not write, kept as the text says it. Written in \\paper as
// LilyPond reads them (oddHeaderMarkup = \\markup \\fill-line { … }); an even
// page with none takes the odd page's. Read back from the text (readPage),
// so a source the engraver of the day passes over keeps them.

/** The four lines, by the model's name and \\paper's. */
export const PAGE_LINES = [["oddHeader", "oddHeaderMarkup"], ["evenHeader", "evenHeaderMarkup"], ["oddFooter", "oddFooterMarkup"], ["evenFooter", "evenFooterMarkup"]];
/** The fields a header or a footer may name: the header's, and the page's number. */
export const PAGE_FIELDS = ["title", "subtitle", "composer", "arranger", "poet", "piece", "opus", "instrument", "copyright", "page"];
const MAX_SYSTEMS_PER_PAGE = 20;

/** At most `count` systems on a page of the PDF; null, "" or 0 for as many as fit. */
export function setSystemsPerPage(score, count) {
  const n = count == null || count === "" ? 0 : Number(count);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SYSTEMS_PER_PAGE) throw new Error(`systems a page: 1 to ${MAX_SYSTEMS_PER_PAGE}, or as many as fit`);
  score.paper = { ...(score.paper ?? paperFrom(null)), systemsPerPage: n || null };
}

/**
 * A header or footer (`which`: oddHeader, evenHeader, oddFooter, evenFooter)
 * from what the page settings say: "left | centre | right", "left | right",
 * or one item, centred; {title}, {composer}, {page}… filled in. Empty: none
 * (an even page then takes the odd page's). A text starting \\markup is kept
 * as it is written.
 */
export function setPageLine(score, which, text) {
  if (!PAGE_LINES.some(([key]) => key === which)) throw new Error(`no such header or footer: ${which}`);
  const said = String(text ?? "").trim();
  if (said.length > 300) throw new Error("a header or a footer is at most 300 characters");
  let line = null;
  if (said.startsWith("\\markup")) line = { raw: said };
  else if (said) {
    const cells = said.split("|").map((cell) => cell.trim());
    if (cells.length > 3) throw new Error("a header or a footer has three places at most: left | centre | right");
    for (const cell of cells) {
      for (const [, name] of cell.matchAll(/\{([^{}]*)\}/g)) {
        if (!PAGE_FIELDS.includes(name)) throw new Error(`{${name}} is not a field a page prints: ${PAGE_FIELDS.map((f) => `{${f}}`).join(", ")}`);
      }
    }
    line = { cells };
  }
  const marks = { ...(score.paper?.marks ?? {}) };
  if (line) marks[which] = line;
  else delete marks[which];
  score.paper = { ...(score.paper ?? paperFrom(null)), marks: Object.keys(marks).length ? marks : null };
}

/** A line as the page settings show it: "left | centre | right", one item alone, or its \\markup. */
export function pageLineText(line) {
  if (!line) return "";
  if (line.raw) return line.raw;
  return line.cells.length === 1 ? line.cells[0] : line.cells.join(" | ");
}

/** One cell as LilyPond markup: a string, a field, or the two \\concat'ed. */
function cellText(cell) {
  const items = [];
  let at = 0;
  for (const m of cell.matchAll(/\{([a-z]+)\}/g)) {
    if (m.index > at) items.push(quote(cell.slice(at, m.index)));
    items.push(m[1] === "page" ? "\\fromproperty #'page:page-number-string" : `\\fromproperty #'header:${m[1]}`);
    at = m.index + m[0].length;
  }
  if (at < cell.length) items.push(quote(cell.slice(at)));
  if (!items.length) return '""';
  return items.length === 1 ? items[0] : `\\concat { ${items.join(" ")} }`;
}

/** A line as \\paper writes it. */
function lineText(line) {
  if (line.raw) return line.raw;
  return `\\markup \\fill-line { ${line.cells.map(cellText).join(" ")} }`;
}

/** LilyPond's tokens: strings, braces, commands, Scheme (#'header:title, #4), words; comments skipped. */
function markupTokens(text) {
  const out = [];
  const re = /%\{[\s\S]*?%\}|%[^\n]*|"((?:[^"\\]|\\.)*)"|([{}])|\\([A-Za-z-]+)|#'?([^\s{}"]*)|([^\s{}"\\#%]+)/g;
  for (const m of text.matchAll(re)) {
    const at = m.index;
    const end = at + m[0].length;
    if (m[1] != null) out.push({ t: "str", v: m[1].replace(/\\(.)/g, "$1"), at, end });
    else if (m[2]) out.push({ t: m[2], at, end });
    else if (m[3]) out.push({ t: "cmd", v: m[3], at, end });
    else if (m[4] != null) out.push({ t: "scheme", v: m[4], at, end });
    else if (m[5]) out.push({ t: "word", v: m[5], at, end });
  }
  return out;
}

/** Where the item at `i` ends (the index after it), read leniently. */
function itemEnd(toks, i) {
  const t = toks[i];
  if (!t) return i;
  if (t.t === "{") {
    let depth = 0;
    for (let j = i; j < toks.length; j++) {
      if (toks[j].t === "{") depth++;
      else if (toks[j].t === "}" && --depth === 0) return j + 1;
    }
    return toks.length;
  }
  if (t.t === "cmd") {
    let j = i + 1;
    while (toks[j]?.t === "scheme") j++;
    // Those that take no markup after their Scheme.
    if (["null", "fromproperty", "hspace", "vspace"].includes(t.v)) return j;
    return toks[j] && toks[j].t !== "}" ? itemEnd(toks, j) : j;
  }
  return i + 1;
}

/** The item at `i` as a cell's words, or null when it says what the model does not write. */
function cellOf(toks, i, end) {
  const t = toks[i];
  if (!t || i >= end) return null;
  if (t.t === "str" || t.t === "word") return /[{}]/.test(t.v) ? null : t.v;
  if (t.t === "cmd" && t.v === "null") return "";
  if (t.t === "cmd" && t.v === "fromproperty") {
    const [group, name] = String(toks[i + 1]?.v ?? "").split(":");
    if (group === "page" && name === "page-number-string") return "{page}";
    return group === "header" && PAGE_FIELDS.includes(name) && name !== "page" ? `{${name}}` : null;
  }
  const joined = (from, sep) => {
    if (toks[from]?.t !== "{") return cellOf(toks, from, itemEnd(toks, from));
    const parts = [];
    for (let j = from + 1; j < itemEnd(toks, from) - 1; j = itemEnd(toks, j)) {
      const part = cellOf(toks, j, itemEnd(toks, j));
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join(sep);
  };
  if (t.t === "{") return joined(i, " ");
  if (t.t === "cmd" && t.v === "concat") return joined(i + 1, "");
  if (t.t === "cmd" && t.v === "line") return joined(i + 1, " ");
  return null;
}

/** A \\markup's line from token `i` (after \\markup) to `end`, or null for one the model does not write. */
function lineOf(toks, i, end) {
  let at = i;
  let close = end;
  if (toks[at]?.t === "{" && toks[at + 1]?.t === "cmd" && toks[at + 1].v === "fill-line") {
    at += 1;
    close = end - 1;
  }
  if (toks[at]?.t !== "cmd" || toks[at].v !== "fill-line") {
    const alone = cellOf(toks, i, end);
    return alone == null ? null : { cells: [alone, "", ""] };
  }
  const from = at + 1;
  if (toks[from]?.t !== "{") return null;
  const cells = [];
  for (let j = from + 1; j < itemEnd(toks, from) - 1 && j < close; j = itemEnd(toks, j)) {
    const cell = cellOf(toks, j, itemEnd(toks, j));
    if (cell == null) return null;
    cells.push(cell);
  }
  return cells.length >= 1 && cells.length <= 3 ? { cells } : null;
}

/**
 * What a source's \\paper says of the headers, the footers and the systems a
 * page: `{ systemsPerPage, marks }` as `score.paper` keeps them.
 */
export function readPage(source) {
  const text = String(source ?? "");
  const out = { systemsPerPage: null, marks: null };
  const toks = markupTokens(text);
  const start = toks.findIndex((t, k) => t.t === "cmd" && t.v === "paper" && toks[k + 1]?.t === "{");
  if (start < 0) return out;
  const end = itemEnd(toks, start + 1);
  const marks = {};
  for (let k = start + 2; k < end - 1; k++) {
    const t = toks[k];
    if (t.t !== "word") continue;
    const assigned = toks[k + 1]?.t === "word" && toks[k + 1].v === "=";
    const name = assigned ? t.v : t.v.replace(/=$/, "");
    const valueAt = assigned ? k + 2 : k + 1;
    if (/^(max-)?systems-per-page$/.test(name)) {
      const n = Number(String(toks[valueAt]?.v ?? "").replace(/^=/, ""));
      if (Number.isInteger(n) && n >= 1) out.systemsPerPage = Math.min(n, MAX_SYSTEMS_PER_PAGE);
      continue;
    }
    const which = PAGE_LINES.find(([, lily]) => lily === name)?.[0];
    if (!which || toks[valueAt]?.t !== "cmd" || toks[valueAt].v !== "markup") continue;
    const after = itemEnd(toks, valueAt + 1);
    marks[which] = lineOf(toks, valueAt + 1, after) ?? { raw: text.slice(toks[valueAt].at, toks[after - 1].end) };
    k = after - 1;
  }
  if (Object.keys(marks).length) out.marks = marks;
  return out;
}

/** Where \\afterGrace's notes start, as a part of their note: LilyPond's afterGraceFraction. */
export const AFTER_GRACE_AT = 3 / 4;

/** A part of a note as \\afterGrace writes it: 7/8, 15/16 — the nearest with a denominator to 64. */
export function afterFraction(at) {
  for (let d = 2; d <= 64; d *= 2) {
    const n = Math.round(at * d);
    if (Math.abs(n / d - at) < 1e-9) return `${n}/${d}`;
  }
  const d = 64;
  return `${Math.min(d - 1, Math.max(1, Math.round(at * d)))}/${d}`;
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
/** The page as the score's text sets it (\\paper, the staff size, \\layout): what MusicXML carries for this editor (#415). */
export function pageSettings(score) {
  return pageText(score);
}

function pageText(score) {
  const p = score.paper ?? {};
  const lines = [];
  if (p.staffSize && p.staffSize !== 20) lines.push(`#(set-global-staff-size ${p.staffSize})`);
  const inside = [];
  if (p.size && p.size !== "a4") inside.push(`#(set-paper-size ${quote(p.size)})`);
  for (const [field, name] of MARGINS) if (p[field] != null) inside.push(`${name} = ${p[field]}\\mm`);
  if (p.evenPages != null) inside.push(`page-breaking = #ly:${p.evenPages ? "optimal" : "minimal"}-breaking`);
  if (p.systemsPerPage) inside.push(`systems-per-page = ${p.systemsPerPage}`);
  for (const [key, name] of PAGE_LINES) if (p.marks?.[key]) inside.push(`${name} = ${lineText(p.marks[key])}`);
  // What \\paper says more, and the \\layout blocks, as they were written.
  inside.push(...(p.more ?? []));
  if (inside.length) lines.push(`\\paper { ${inside.join(" ")} }`);
  lines.push(...(score.layout ?? []));
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
    read = fromParsed(JSON.parse(parse(source)), source);
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
  // A speed set inside a bar holds from the next bar on (its own bar's rest is a ramp's: see tempoRamps).
  for (const m of tempoMarks(score)) {
    if (m.bar > b || (m.bar === b && m.pos > 0) || !m.tempo?.bpm) continue;
    bpm = m.tempo.bpm;
    base = m.tempo.base || base;
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

/**
 * Until when lane `s`'s note `i` is struck again, on each pass through its
 * bar: when it is heard (heardAt), or — for a note whose MIDI plays more than
 * its one stroke, grace notes after it (\\afterGrace) or a trill — its end,
 * every stroke of those being the note's (#415).
 */
export function heardUntil(score, passes, s, i, t = starts(score.staves[s])[i]) {
  const ev = score.staves[s].events[i];
  const heard = heardAt(score, passes, s, i, t);
  if (ev.rest || !(ev.afterGraces?.length || ev.arts.includes("trill"))) return heard;
  return heard.map((sec, k) => {
    const p = passes.filter((x) => x.bar === barAt(score, t))[k];
    return playedAt(score, passes, t)[k] + (ticksOf(ev) / M_TICKS(p.base)) * (60 / p.bpm);
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
    // A pickup is the end of a bar: its beats are the bar's last ones. A bar
    // of its own length (a cadenza, a bar cut short) counts its beats from its start.
    const length = barLength(score, p.bar);
    const odd = isOddBar(score, p.bar);
    const missing = odd ? 0 : (WHOLE * num) / den - length;
    const parts = subdivide > den && subdivide % den === 0 ? subdivide / den : 1;
    const count = odd ? Math.ceil(length / (WHOLE / den) - 1e-9) : num;
    for (let k = 0; k < count; k++) {
      for (let j = 0; j < parts; j++) {
        const into = (k * WHOLE) / den + (j * WHOLE) / (den * parts) - missing;
        if (into < 0 || into > length - 1e-6) continue;
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

/** What two pitched staves must have alike to share a channel: the instrument, the mixer's settings, no curves, no synthesizer or own SoundFont (#391). */
function sharingKey(score, lane) {
  const curves = score.meta?.cc?.[lane];
  if (curves && Object.keys(curves).length) return `lane ${lane}`;
  if (score.meta?.synth?.[lane] || score.meta?.soundfont?.[lane]) return `lane ${lane}`;
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
  const first = s === firstMusic(score);
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

// ---- Kept as written: \override, \set, \tweak, \with, \layout, \paper ----------------------------
//
// What the model does not understand but must not lose is kept as the text
// wrote it, in the place it holds in the music:
//
// - `ev.before`: the commands written right before a note or rest that set
//   how things are drawn — \override, \revert, \set, \unset, \tweak, \hide,
//   \omit, with \once, \temporary or \undo before them — each its text. One
//   that holds on (not \once, not \tweak) stays in the music when its note
//   is written over or its bar taken away: it moves to what comes there.
// - `staff.withMore`: what a staff's \with says beside its names and sound
//   (\RemoveEmptyStaves, \override StaffSymbol.line-count = 1, \consists …).
// - `score.layout`: each \layout block, as written.
// - `score.paper.more`: what \paper says beside the paper, the margins, the
//   spreading of lines, the systems a page and the headers and footers.
//
// Each is read from the source with the notes' places in it (eui-score's
// `source_spans`), so a text the model wrote itself reads back the same.

/** The commands kept before a note: how they start. */
const KEPT_COMMANDS = ["override", "revert", "set", "unset", "tweak", "hide", "omit"];
const KEPT_PREFIXES = ["once", "temporary", "undo", "single"];
/** The sizes notes are set in, from there on: kept as written too. */
const KEPT_SIZES = ["teeny", "tiny", "small", "normalsize", "large", "huge"];
/** What the model writes itself, so does not keep: a text span's words. */
const WRITTEN_BY_MODEL = /^\\override TextSpanner\.bound-details\.left\.text\b|^\\set (Staff\.)?timeSignatureFraction\b/;

/** Where the blanks and comments from `i` end. */
function skipBlank(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith("%{", i)) {
      const end = src.indexOf("%}", i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (src[i] === "%") {
      const end = src.indexOf("\n", i);
      i = end < 0 ? src.length : end + 1;
    } else return i;
  }
}

/** Where the string starting at `i` (its opening quote) ends, after its closing one. */
function stringEnd(src, i) {
  let k = i + 1;
  while (k < src.length && src[k] !== '"') k += src[k] === "\\" ? 2 : 1;
  return Math.min(src.length, k + 1);
}

/** Where `open` at `i` is closed by its `close`, past it; strings and comments skipped. */
function balancedEnd(src, i, open, close) {
  let depth = 0;
  let k = i;
  while (k < src.length) {
    const c = src[k];
    if (c === '"') k = stringEnd(src, k);
    else if (c === "%" && open !== "(") k = skipBlank(src, k);
    else if (c === ";" && open === "(") {
      const end = src.indexOf("\n", k);
      k = end < 0 ? src.length : end + 1;
    } else {
      if (c === open) depth++;
      else if (c === close && --depth === 0) return k + 1;
      k++;
    }
  }
  return src.length;
}

/** Where a Scheme value at `i` (its #) ends: #red, ##t, #'(1 . 2), #(rgb-color 1 0 0), #{ … #}. */
function schemeEnd(src, i) {
  let k = i + 1;
  // ##t, ##f, and a vector, ##(#t #t #f).
  if (src[k] === "#") return src[k + 1] === "(" ? balancedEnd(src, k + 1, "(", ")") : k + 1 + (/^[a-z]+/i.exec(src.slice(k + 1))?.[0].length ?? 0);
  if (src[k] === "{") {
    const end = src.indexOf("#}", k);
    return end < 0 ? src.length : end + 2;
  }
  while ("'`,".includes(src[k]) && k < src.length) k++;
  if (src[k] === "(") return balancedEnd(src, k, "(", ")");
  if (src[k] === '"') return stringEnd(src, k);
  while (k < src.length && !/[\s{}()"]/.test(src[k])) k++;
  return k;
}

/** The name of the command at `i` (a backslash), or null. */
function commandAt(src, i) {
  return src[i] === "\\" ? /^\\([A-Za-z]+(?:-[A-Za-z]+)*)/.exec(src.slice(i, i + 64))?.[1] ?? null : null;
}

/** Where a markup at `i` ends: its commands, their Scheme, then a braced list, a string or a word. */
function markupEnd(src, i) {
  let k = skipBlank(src, i);
  for (let guard = 0; guard < 64 && k < src.length; guard++) {
    if (src[k] === "{") return balancedEnd(src, k, "{", "}");
    if (src[k] === '"') return stringEnd(src, k);
    if (src[k] === "#") k = skipBlank(src, schemeEnd(src, k));
    else if (src[k] === "\\") {
      const name = commandAt(src, k);
      if (!name) return k + 1;
      k = skipBlank(src, k + 1 + name.length);
      // A command that takes nothing: the markup ends with it.
      if (["null", "hspace", "vspace", "fromproperty"].includes(name) && src[k] !== "#") return k;
    } else {
      while (k < src.length && !/[\s{}"\\]/.test(src[k])) k++;
      return k;
    }
  }
  return k;
}

/** Where a value at `i` ends: Scheme, a string, a markup, a number with its unit, \default, a word. */
function valueEnd(src, i) {
  const k = skipBlank(src, i);
  if (src[k] === "#") return schemeEnd(src, k);
  if (src[k] === '"') return stringEnd(src, k);
  const name = commandAt(src, k);
  if (name === "markup" || name === "markuplist") return markupEnd(src, k + 1 + name.length);
  if (name) return k + 1 + name.length;
  const number = /^-?\d+(?:\.\d+)?(?:\s*\\(?:mm|cm|in|pt))?/.exec(src.slice(k, k + 32));
  if (number) return k + number[0].length;
  let end = k;
  while (end < src.length && !/[\s{}"\\]/.test(src[end])) end++;
  return end;
}

/** Where a grob's or a property's path at `i` ends: Staff.NoteHead.color, and old #'symbols after it. */
function pathEnd(src, i) {
  let k = skipBlank(src, i);
  if (src[k] === "#") k = schemeEnd(src, k);
  else while (k < src.length && /[A-Za-z0-9.\-]/.test(src[k])) k++;
  for (;;) {
    const next = skipBlank(src, k);
    // An old #'symbol of the path; #'(0 . 1) is a value.
    if (src.startsWith("#'", next) && /[A-Za-z]/.test(src[next + 2] ?? "")) k = schemeEnd(src, next);
    else return k;
  }
}

/**
 * A command kept before a note, read at `i` (its backslash): `{ end, text }`,
 * or null when it is not one, or is one the model writes itself.
 */
function keptCommandAt(src, i) {
  const name = commandAt(src, i);
  if (!name) return null;
  let k = i + 1 + name.length;
  if (KEPT_PREFIXES.includes(name)) {
    const inner = keptCommandAt(src, skipBlank(src, k));
    return inner ? { end: inner.end, text: `\\${name} ${inner.text}`, tweak: inner.tweak } : null;
  }
  if (KEPT_SIZES.includes(name)) return { end: k, text: `\\${name}`, tweak: false };
  if (!KEPT_COMMANDS.includes(name)) return null;
  k = pathEnd(src, k);
  if (name === "override" || name === "set") {
    const eq = skipBlank(src, k);
    if (src[eq] === "=") k = eq + 1;
    k = valueEnd(src, k);
  } else if (name === "tweak") {
    // \tweak color #red: a property then its value (\tweak NoteHead.color …, \tweak #'color …).
    k = valueEnd(src, k);
  }
  const text = src.slice(i, k).replace(/\s+/g, " ").trim();
  if (WRITTEN_BY_MODEL.test(text)) return null;
  return { end: k, text, tweak: name === "tweak" };
}

/** Where what a block command at `i` takes ends: `\\with { … }`, `\\layout { … }` and the like. */
function blockEnd(src, i) {
  const k = skipBlank(src, i);
  return src[k] === "{" ? balancedEnd(src, k, "{", "}") : k;
}

/**
 * The commands kept before each note and rest of `source`, by the
 * engraver's number for it: Map i → [text]. `spans` are `source_spans`.
 */
export function keptCommands(source, spans) {
  const out = new Map();
  if (!source || !Array.isArray(spans)) return out;
  const ends = spans.filter(Boolean).map((sp) => sp[1]).sort((x, y) => x - y);
  spans.forEach((span, i) => {
    if (!span) return;
    // From the end of the note written just before it in the text (the last end at or before its start).
    let lo = 0;
    let hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] <= span[0]) lo = mid + 1;
      else hi = mid;
    }
    const from = lo > 0 ? ends[lo - 1] : 0;
    const kept = [];
    let k = from;
    while (k < span[0]) {
      const c = source[k];
      if (c === '"') k = stringEnd(source, k);
      else if (c === "%") k = skipBlank(source, k);
      else if (c === "#") k = schemeEnd(source, k);
      else if (c === "\\") {
        const name = commandAt(source, k);
        if (!name) {
          k += 2;
          continue;
        }
        // Blocks that hold settings of their own, and words: passed over whole.
        if (["with", "layout", "paper", "header", "midi"].includes(name)) {
          k = blockEnd(source, k + 1 + name.length);
          continue;
        }
        if (name === "markup" || name === "markuplist") {
          k = markupEnd(source, k + 1 + name.length);
          continue;
        }
        // After a note's -, ^ or _ it is that note's, not the next one's.
        const attached = k > 0 && "-^_".includes(source[k - 1]);
        const command = attached ? null : keptCommandAt(source, k);
        if (!command || command.end > span[0]) {
          k += 1 + name.length;
          continue;
        }
        // A \tweak is the next note's only when that note follows it.
        const next = skipBlank(source, command.end);
        if (!command.tweak || next === span[0]) kept.push(command.text);
        k = command.end;
      } else k++;
    }
    if (kept.length) out.set(i, kept);
  });
  return out;
}

// A \\tweak written on what follows a note — an articulation, a dynamic,
// words, a slur — `c4-\\tweak color #red ->`, `-\\tweak extra-offset #'(0 . 1)
// ^"x"`: kept on the note, `ev.tweaks` [{ on, lead, text }], `on` what it
// tweaks (see postEventAt), `lead` the -, ^ or _ written before it, `text`
// the \\tweak (or the several written one after another). It is written
// again before what it tweaks as long as the note has that.

/** The articulations written with a sign: -> -. -- -^ -! -_ -+. */
const SCRIPT_SIGNS = { ">": "accent", ".": "staccato", "-": "tenuto", "^": "marcato", "!": "staccatissimo", _: "portato", "+": "stopped" };
/** The commands written after a note, by what of the note they are. */
const POST_COMMANDS = { glissando: "gliss", arpeggio: "arpeggio", laissezVibrer: "lv", repeatTie: "repeatTie", sustainOn: "pedalOn", sustainOff: "pedalOff", startTextSpan: "spanStart" };

/** What the post-event at `i` is, for a \\tweak before it: { on, end }, or null. */
function postEventAt(src, i) {
  let k = i;
  if ("-^_".includes(src[k] ?? "")) {
    if (SCRIPT_SIGNS[src[k + 1]]) return { on: `art:${SCRIPT_SIGNS[src[k + 1]]}`, end: k + 2 };
    k++;
  }
  const digits = /^\d+/.exec(src.slice(k, k + 4))?.[0];
  if (digits) return { on: `finger:${digits}`, end: k + digits.length };
  if (src[k] === '"') {
    const end = stringEnd(src, k);
    return { on: `text:${src.slice(k + 1, end - 1).replace(/\\(.)/g, "$1")}`, end };
  }
  if (src[k] === "(") return { on: "slur", end: k + 1 };
  if (src[k] === "~") return { on: "tie", end: k + 1 };
  if (src.startsWith("\\(", k)) return { on: "phrase", end: k + 2 };
  if (src.startsWith("\\<", k) || src.startsWith("\\>", k)) return { on: "hairpin", end: k + 2 };
  if (src.startsWith("\\!", k)) return { on: "hairpinEnd", end: k + 2 };
  const name = commandAt(src, k);
  if (!name) return null;
  const end = k + 1 + name.length;
  if (name === "markup") {
    // Words in \\markup: by their text, as the engraver reads it.
    const to = markupEnd(src, end);
    const inner = src.slice(end, to);
    const quoted = /"((?:[^"\\]|\\.)*)"/.exec(inner)?.[1];
    const words = quoted != null ? quoted.replace(/\\(.)/g, "$1") : inner.replace(/\\[A-Za-z-]+|[{}]/g, " ").trim().replace(/\s+/g, " ");
    return { on: `text:${words}`, end: to };
  }
  if (DYNAMICS.includes(name)) return { on: "dynamic", end };
  if (HAIRPIN_WORDS.includes(name)) return { on: "hairpin", end };
  if (SCRIPTS[name]) return { on: `art:${name}`, end };
  if (POST_COMMANDS[name]) return { on: POST_COMMANDS[name], end };
  return null;
}

/**
 * The \\tweak written on each note's post-events in `source`, by the
 * engraver's number for the note: Map i → [{ on, lead, text }]. `spans` are
 * `source_spans`.
 */
export function postTweaks(source, spans) {
  const out = new Map();
  if (!source || !Array.isArray(spans)) return out;
  const order = spans.map((sp, i) => (sp ? i : -1)).filter((i) => i >= 0).sort((x, y) => spans[x][0] - spans[y][0] || x - y);
  order.forEach((i, n) => {
    // A note numbered twice (written once): the first number's.
    if (n > 0 && spans[order[n - 1]][0] === spans[i][0]) return;
    const from = spans[i][1];
    const next = order.slice(n + 1).find((j) => spans[j][0] > spans[i][0]);
    const to = next == null ? source.length : spans[next][0];
    const found = [];
    let k = from;
    while (k < to) {
      const c = source[k];
      if (c === '"') k = stringEnd(source, k);
      else if (c === "%") k = skipBlank(source, k);
      else if (c === "#") k = schemeEnd(source, k);
      else if ("-^_".includes(c) && commandAt(source, skipBlank(source, k + 1)) === "tweak") {
        const texts = [];
        let j = skipBlank(source, k + 1);
        while (commandAt(source, j) === "tweak") {
          const command = keptCommandAt(source, j);
          if (!command) break;
          texts.push(command.text);
          j = skipBlank(source, command.end);
        }
        const target = texts.length ? postEventAt(source, j) : null;
        if (target && target.end <= to) {
          found.push({ on: target.on, lead: c, text: texts.join(" ") });
          k = target.end;
        } else k = j + 1;
      } else k++;
    }
    if (found.length) out.set(i, found);
  });
  return out;
}

/** Whether a kept command holds on after its note: not \once, not a \tweak of that note. */
const holdsOn = (text) => !/^\\(once|tweak|single)\b/.test(text);

/** The kept commands of `events` that hold on, in order. */
function heldCommands(events) {
  return events.flatMap((ev) => (ev.before ?? []).filter(holdsOn));
}

/** The \\with block of each `\\new Staff` (DrumStaff, TabStaff…) of `source`, in order: its text, or null. */
function staffWiths(source) {
  const out = [];
  const re = /\\(?:new|context)\s+(Staff|DrumStaff|TabStaff|RhythmicStaff|Lyrics|ChordNames|FiguredBass|PianoStaff|GrandStaff|StaffGroup|ChoirStaff|Voice|CueVoice|Dynamics|NullVoice)\b/g;
  const text = String(source ?? "");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let k = skipBlank(text, m.index + m[0].length);
    // `= "name"`
    if (text[k] === "=") {
      k = skipBlank(text, k + 1);
      k = text[k] === '"' ? stringEnd(text, k) : valueEnd(text, k);
      k = skipBlank(text, k);
    }
    const isWith = commandAt(text, k) === "with";
    let body = null;
    if (isWith) {
      const open = skipBlank(text, k + 5);
      const end = blockEnd(text, k + 5);
      body = text.slice(open + 1, end - 1);
    }
    out.push({ kind: m[1], body, at: m.index });
  }
  return out;
}

/** What a \\with block says beside the names and sound the model writes: its text, or "". */
function withMore(body) {
  let rest = String(body ?? "");
  for (const name of ["instrumentName", "shortInstrumentName", "midiInstrument"]) {
    for (;;) {
      const m = new RegExp(`(^|\\s)${name}\\s*=`).exec(rest);
      if (!m) break;
      const end = valueEnd(rest, m.index + m[0].length);
      rest = rest.slice(0, m.index) + rest.slice(end);
    }
  }
  return rest.replace(/\s+/g, " ").trim();
}

/** Each \\layout block of `source`, as written, outside a \\with or a \\paper. */
function layoutBlocks(source) {
  const text = String(source ?? "");
  const out = [];
  let k = 0;
  while (k < text.length) {
    const c = text[k];
    if (c === '"') k = stringEnd(text, k);
    else if (c === "%") k = skipBlank(text, k);
    else if (c === "#") k = schemeEnd(text, k);
    else if (c === "\\") {
      const name = commandAt(text, k);
      if (!name) {
        k += 2;
        continue;
      }
      if (name === "layout") {
        const end = blockEnd(text, k + 7);
        out.push(text.slice(k, end).replace(/\s+/g, " ").trim());
        k = end;
      } else if (["with", "paper", "header", "midi"].includes(name)) k = blockEnd(text, k + 1 + name.length);
      else if (name === "markup") k = markupEnd(text, k + 7);
      else k += 1 + name.length;
    } else k++;
  }
  return out;
}

// What \\paper says that the model writes itself (see pageText, readPage).
const PAPER_WRITTEN = /^(left-margin|right-margin|top-margin|bottom-margin|indent|page-breaking|(max-)?systems-per-page|(odd|even)(Header|Footer)Markup)$/;

/** What the first \\paper block of `source` says beside what the model writes: each setting's text. */
function paperMore(source) {
  const text = String(source ?? "");
  const at = /\\paper\s*\{/.exec(text);
  if (!at) return [];
  const open = text.indexOf("{", at.index);
  const end = balancedEnd(text, open, "{", "}") - 1;
  const out = [];
  let k = skipBlank(text, open + 1);
  while (k < end) {
    const start = k;
    if (text[k] === "#") {
      k = schemeEnd(text, k);
      const said = text.slice(start, k);
      if (!/^#\(set-paper-size\b/.test(said)) out.push(said.replace(/\s+/g, " "));
    } else {
      const name = /^[A-Za-z][A-Za-z0-9-]*/.exec(text.slice(k, k + 80))?.[0];
      if (!name) {
        k = text[k] === "\\" ? valueEnd(text, k) : k + 1;
        k = skipBlank(text, k);
        continue;
      }
      k = skipBlank(text, k + name.length);
      if (text[k] === "=") k = valueEnd(text, k + 1);
      if (!PAPER_WRITTEN.test(name)) out.push(text.slice(start, k).replace(/\s+/g, " ").trim());
    }
    k = skipBlank(text, k);
  }
  return out;
}

/** Whether the warning's name (from passedOver) is kept by what the model holds. */
function keptName(name, held) {
  const plain = (t) => t.replace(/\s+/g, " ").trim();
  const inWith = / in \\with$/.exec(name);
  if (inWith) return held.withs.some((w) => w.includes(plain(name.slice(0, inWith.index))));
  if (/^the \\layout block/.test(name)) return held.layout.length > 0;
  const paper = /^\\paper's (.+)$/.exec(name);
  if (paper) return held.paper.some((p) => p.startsWith(paper[1]));
  return held.commands.some((c) => c.includes(plain(name)));
}

// ---- An ossia: another way of playing some bars, on a small staff over them ---------------
//
// `\new Staff \with { alignAboveContext = "main" } { … }` beside a staff's
// bars, inside `<< >>`: kept on that staff as `staff.ossias`, each
// { bar, bars, with, clef, events } — the bars it stands over, its \with as
// written, its clef, and its notes from the first of those bars (spacers
// where it is silent). It is shown and played as written; the bars under it
// are edited as any others, and it moves with them.

/** An ossia's lanes (from the parse) kept on the staff its \\with names; false when it cannot be. */
function ossiaOf(score, lanes, body, placed) {
  const [lane, ...others] = lanes;
  if (others.some((o) => sounding(o.events))) return false;
  const name = /\balign(?:Above|Below)Context\s*=\s*"([^"]+)"/.exec(body ?? "")?.[1];
  const main = placed.flat().find((x) => !x.voice && x.id === name && x !== lane);
  if (!main) return false;
  const at = starts(lane);
  const real = lane.events.map((ev, i) => (ev.mirror ? -1 : i)).filter((i) => i >= 0);
  if (!real.length) return true;
  const first = barAt(score, at[real[0]]);
  const lastEv = real[real.length - 1];
  const last = barAt(score, at[lastEv] + ticksOf(lane.events[lastEv]) - 1);
  const from = barStart(score, first);
  const to = barStart(score, last + 1);
  const events = lane.events
    .filter((_, i) => at[i] >= from && at[i] < to)
    .map(({ mirror, ...ev }) => (mirror ? makeEvent({ base: ev.base, dots: ev.dots, tuplet: ev.tuplet, spacer: true }) : ev));
  // Its clef, when it is not its staff's there (the engraver gives it its staff's otherwise).
  const clefOf = (x) => [...(x.clefs ?? [])].filter((c) => c.bar <= first).pop()?.clef ?? x.clef ?? "treble";
  const clef = clefOf(lane) === clefOf(main) ? null : clefOf(lane);
  main.ossias = [...(main.ossias ?? []), { bar: first, bars: last - first + 1, with: body.replace(/\s+/g, " ").trim(), ...(clef ? { clef } : {}), events }];
  return true;
}

/** Events as LilyPond, their tuplets (one in another too) around them, with no bar checks. */
function plainMusic(events) {
  const parts = [];
  let open = null;
  let inner = null;
  for (const ev of events) {
    const tid = tupletGroup(ev);
    const iid = ev.tuplet?.outer ? ev.tuplet.id : null;
    if (inner !== null && (iid !== inner || tid !== open)) {
      parts.push("}");
      inner = null;
    }
    if (open !== null && tid !== open) {
      parts.push("}");
      open = null;
    }
    if (tid !== null && open === null) {
      const around = ev.tuplet.outer ?? ev.tuplet;
      parts.push(`\\tuplet ${around.n}/${around.d} {`);
      open = tid;
    }
    if (iid !== null && inner === null) {
      parts.push(`\\tuplet ${ev.tuplet.n}/${ev.tuplet.d} {`);
      inner = iid;
    }
    parts.push(eventText(ev));
  }
  if (inner !== null) parts.push("}");
  if (open !== null) parts.push("}");
  return parts.join(" ");
}

/** An ossia as LilyPond: its staff, its \\with, its clef, its music. */
function ossiaText(o) {
  const clef = o.clef && o.clef !== "treble" ? `\\clef ${clefText(o.clef)} ` : "";
  return `\\new Staff \\with { ${o.with} } { ${clef}${plainMusic(o.events)} }`;
}

/** The ossias over bars `a`…`b` taken away (they go with their bars); those after move back by `count`. */
function ossiasAfterDelete(staff, a, b, count) {
  if (!staff.ossias) return;
  staff.ossias = staff.ossias.filter((o) => o.bar + o.bars - 1 < a || o.bar > b).map((o) => (o.bar > b ? { ...o, bar: o.bar - count } : o));
  if (!staff.ossias.length) delete staff.ossias;
}

// ---- Staves kept as written: \partCombine, \autoChange --------------------------------------
//
// Two parts set on one staff (`\partCombine \a \b`) or one part spread over
// a piano's two staves (`\new PianoStaff \autoChange { … }`) are edited on
// the score (see "Two parts on one staff" below). What that cannot take
// apart — `\partCombineUp`, a part saying how the parts are combined, music
// beside the command on its staff — or a reading without the engraver at
// hand: the engraver decides where each note goes, so the model keeps the
// staff's text as written — `staff.raw` on its first staff, `rawPart` on the others it makes
// — with the variables it names (`score.defs`). Its notes are read, shown
// and played; they are edited in the text, the other staves on the score.

/** The commands that make a staff the model keeps as written. */
const RAW_COMMANDS = ["partCombine", "partcombine", "partCombineUp", "partCombineDown", "autoChange", "autochange"];

/** Where a pitch written at `i` ends: c, fis'', bes,! … */
function pitchEnd(src, i) {
  const k = skipBlank(src, i);
  const m = /^[a-z]+[',]*[!?]?/.exec(src.slice(k, k + 16));
  return m ? k + m[0].length : k;
}

/** Where the music expression at `i` ends: braces, << >>, a command and what it takes, a variable, a note. */
function musicEnd(src, i, depth = 0) {
  const k = skipBlank(src, i);
  if (depth > 32 || k >= src.length) return k;
  if (src.startsWith("<<", k)) {
    let level = 0;
    let j = k;
    while (j < src.length) {
      if (src[j] === '"') j = stringEnd(src, j);
      else if (src[j] === "%") j = skipBlank(src, j);
      else if (src.startsWith("<<", j)) {
        level++;
        j += 2;
      } else if (src.startsWith(">>", j)) {
        level--;
        j += 2;
        if (level === 0) return j;
      } else j++;
    }
    return src.length;
  }
  if (src[k] === "{") return balancedEnd(src, k, "{", "}");
  const name = commandAt(src, k);
  if (!name) {
    let j = k;
    while (j < src.length && !/[\s{}<>"\\]/.test(src[j])) j++;
    return Math.max(j, k + 1);
  }
  let j = k + 1 + name.length;
  const next = (n) => {
    for (let c = 0; c < n; c++) j = musicEnd(src, j, depth + 1);
  };
  switch (name) {
    case "new":
    case "context": {
      j = skipBlank(src, j);
      while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
      let at = skipBlank(src, j);
      if (src[at] === "=") {
        at = skipBlank(src, at + 1);
        j = src[at] === '"' ? stringEnd(src, at) : valueEnd(src, at);
        at = skipBlank(src, j);
      }
      if (commandAt(src, at) === "with") j = blockEnd(src, at + 5);
      next(1);
      return j;
    }
    case "relative": {
      const at = skipBlank(src, j);
      if (/[a-g]/.test(src[at] ?? "") && commandAt(src, at) == null) j = pitchEnd(src, at);
      next(1);
      return j;
    }
    case "fixed":
      j = pitchEnd(src, j);
      next(1);
      return j;
    case "transpose":
      j = pitchEnd(src, pitchEnd(src, j));
      next(1);
      return j;
    case "partCombine":
    case "partcombine":
    case "partCombineUp":
    case "partCombineDown":
      next(2);
      return j;
    case "autoChange":
    case "autochange":
    case "drummode":
    case "chordmode":
    case "figuremode":
    case "lyricmode":
    case "notemode":
    case "unfoldRepeats":
      next(1);
      return j;
    case "times":
    case "tuplet": {
      j = skipBlank(src, j);
      while (j < src.length && /[\d/]/.test(src[j])) j++;
      const at = skipBlank(src, j);
      if (/\d/.test(src[at] ?? "")) j = valueEnd(src, at);
      next(1);
      return j;
    }
    case "repeat": {
      j = valueEnd(src, valueEnd(src, j));
      next(1);
      const at = skipBlank(src, j);
      if (commandAt(src, at) === "alternative") j = musicEnd(src, at + 12, depth + 1);
      return j;
    }
    default:
      return j;
  }
}

/** The top-level definitions of `source`, `name = …`: Map name → { at, end, text }. */
function definitions(source) {
  const text = String(source ?? "");
  const out = new Map();
  let k = 0;
  let depth = 0;
  while (k < text.length) {
    const c = text[k];
    if (c === '"') k = stringEnd(text, k);
    else if (c === "%") k = skipBlank(text, k);
    else if (c === "#") k = schemeEnd(text, k);
    else if (c === "{" || c === "<") {
      if (c === "{") depth++;
      k++;
    } else if (c === "}") {
      depth--;
      k++;
    } else if (depth === 0 && /[A-Za-z]/.test(c) && (k === 0 || /\s/.test(text[k - 1]))) {
      const m = /^([A-Za-z][A-Za-z_]*)\s*=\s*/.exec(text.slice(k, k + 128));
      if (!m) {
        while (k < text.length && /\S/.test(text[k])) k++;
        continue;
      }
      const end = musicEnd(text, k + m[0].length);
      out.set(m[1], { at: k, end, text: text.slice(k, end) });
      k = end;
    } else k++;
  }
  return out;
}

/** The names of the definitions `text` uses, and those they use in turn, in the source's order. */
function usedDefinitions(text, defs, seen = new Set()) {
  for (const m of String(text).matchAll(/\\([A-Za-z]+)\b/g)) {
    const def = defs.get(m[1]);
    if (!def || seen.has(m[1])) continue;
    seen.add(m[1]);
    usedDefinitions(def.text, defs, seen);
  }
  return [...seen].sort((x, y) => defs.get(x).at - defs.get(y).at);
}

/**
 * The stretches of `source` kept as written: each `\\partCombine` or
 * `\\autoChange` with the staff (or the piano staff) around it — [{ at, end,
 * text, used }], `used` the definitions it names.
 */
function rawStretches(source) {
  const text = String(source ?? "");
  const defs = definitions(text);
  const out = [];
  const found = [...text.matchAll(new RegExp(`\\\\(${RAW_COMMANDS.join("|")})\\b`, "g"))].map((m) => m.index);
  for (const p of found) {
    // Not one inside a definition: its staff is wherever the variable is used.
    if ([...defs.values()].some((d) => p >= d.at && p < d.end)) return null;
    if (out.some((r) => p >= r.at && p < r.end)) continue;
    // The staff around it: the nearest \\new … whose music holds it, or the command alone.
    let stretch = { at: p, end: musicEnd(text, p) };
    for (const m of [...text.slice(0, p).matchAll(/\\new\s+(Staff|PianoStaff|GrandStaff|DrumStaff)\b/g)].reverse()) {
      const end = musicEnd(text, m.index);
      if (end > p) {
        stretch = { at: m.index, end };
        break;
      }
    }
    const raw = text.slice(stretch.at, stretch.end);
    out.push({ ...stretch, text: raw, used: usedDefinitions(raw, defs), group: /^\\new\s+(PianoStaff|GrandStaff)\b/.test(raw) });
  }
  return { stretches: out, defs };
}

/** The staves of `parsed` that `stretch` makes: their indexes, by where their notes are written. */
function stavesOf(parsed, spans, stretch, defs) {
  const places = [stretch, ...stretch.used.map((name) => defs.get(name))];
  return parsed.staves
    .map((st, k) => (st.events.some((ev) => (ev.k === "Note" || ev.k === "Rest") && spans?.[ev.i] && places.some((r) => spans[ev.i][0] >= r.at && spans[ev.i][0] < r.end)) ? k : -1))
    .filter((k) => k >= 0);
}

/** The staves made by \\partCombine and \\autoChange marked kept as written (see above); what cannot be, named. */
function keepRaw(score, parsed, placed, source, spans, unsupported) {
  const found = rawStretches(source);
  if (!found) {
    unsupported.add("\\partCombine or \\autoChange in a variable");
    return;
  }
  const { stretches, defs } = found;
  const numbers = (k) => parsed.staves[k].events.filter((ev) => ev.k === "Note" || ev.k === "Rest");
  const all = parsed.staves.flatMap((st, k) => numbers(k).map((ev) => ev.i));
  const ossiasBefore = (k) => parsed.staves.slice(0, k).filter((st) => st.kind === "Ossia").length;
  const used = new Set();
  for (const stretch of stretches) {
    const ks = stavesOf(parsed, spans, stretch, defs).filter((k) => placed[k].length);
    if (!ks.length) {
      unsupported.add("\\partCombine or \\autoChange the editor cannot place");
      continue;
    }
    const mine = ks.flatMap((k) => numbers(k));
    const from = Math.min(...mine.map((ev) => ev.i));
    const last = Math.max(...mine.map((ev) => ev.i));
    const to = Math.min(1 + Math.max(...all), ...all.filter((i) => i > last && !mine.some((ev) => ev.i === i)));
    const drawn = new Set(mine.filter((ev) => !ev.spacer).map((ev) => ev.i));
    const head = placed[ks[0]][0];
    head.raw = stretch.text;
    head.rawItems = Array.from({ length: Math.max(0, to - from) }, (_, n) => drawn.has(from + n));
    for (const k of ks.slice(1)) placed[k][0].rawPart = true;
    for (const name of stretch.used) used.add(name);
    // A piano staff it makes is in its text: the model's group around those staves goes.
    if (stretch.group) {
      const first = ks[0] - ossiasBefore(ks[0]);
      const lastStaff = ks[ks.length - 1] - ossiasBefore(ks[ks.length - 1]);
      score.groups = score.groups.filter((g) => !(g.first >= first && g.last <= lastStaff));
      const staves = parsed.staves.filter((st) => st.kind !== "Ossia").length;
      if (first === 0 && lastStaff === staves - 1) score.group = "none";
    }
  }
  if (used.size) score.defs = [...used].sort((x, y) => defs.get(x).at - defs.get(y).at).map((name) => defs.get(name).text);
}

/** Whether lane `s` belongs to a staff kept as written. */
export function isRaw(score, s) {
  const staff = score.staves[upperOf(score, s)];
  return Boolean(staff?.raw != null || staff?.rawPart);
}

/** An edit on a staff kept as written: refused, said. */
function refuseRaw(score, s) {
  if (isRaw(score, s)) throw new Error(RAW_REFUSAL);
}

/** An edit that would change every staff's bars, with a staff kept as written: refused, said. */
function refuseRawBars(score) {
  if (score.staves.some((staff) => staff.raw != null || staff.rawPart)) throw new Error(RAW_BARS_REFUSAL);
}

const RAW_WHY = "a \\partCombine or \\autoChange the score editor cannot take apart: \\partCombineUp, \\partCombineApart and the like, music beside it on its staff";
const RAW_REFUSAL = `This staff is kept as LilyPond wrote it (${RAW_WHY}): edit its notes in the text below`;
const RAW_BARS_REFUSAL = `A staff is kept as LilyPond wrote it (${RAW_WHY}): put bars in or take them away in the text below`;

// ---- Two parts on one staff (\partCombine), one voice over two (\autoChange) ----------------
//
// Both are edited on the score (#413). The engraver decides where each note
// goes; the model holds the music as written:
//
// - `\partCombine A B`: a staff of two voices, `staff.combine` on its first
//   lane — voice 1 is part I (A), voice 2 part II (B), each every note and
//   rest of its part. It is written back `\partCombine { … } { … }`, or with
//   the variables the source named (`combine.names`: `\partCombine \hornI
//   \hornII`, their music written as `hornI = { … }`). The engraver draws
//   one note for both where they play it together ("a2"), a chord where they
//   move in the same rhythm, "Solo" where one rests: `combinedShown` says
//   which of each part's notes it draws, so that a click on a note drawn
//   once selects part I's, and part II's is lit through it.
// - `\autoChange M`, in a `\new PianoStaff` (or a GrandStaff, or alone): a
//   staff of one voice, `staff.autoChange` ({ split, piano }), drawn by the
//   engraver over the piano's two staves — every note under the split
//   (middle C) on the lower one. The lower staff's rests are numbered after
//   the voice's notes, one for each: `echo` items, its event's.
//
// To read them the model asks the engraver for a text that says the same in
// the model's terms (`splitCombined`: `<< A \\ B >>`, `\new Staff M`).
// What still cannot be held — a `\partCombineUp`, a part that changes how
// the parts are combined, music beside the command on its staff — stays kept
// as written (see above).

/** The commands read this way: every one, and whether a text holds one. */
const COMBINE_RE = /\\(partCombine|partcombine|autoChange|autochange)(?![A-Za-z])/g;
const COMBINE_ONE = new RegExp(COMBINE_RE.source);
/** What the parts may say that the model cannot hold: how they are combined, two voices in one. */
const COMBINE_MODES = /\\(partCombine[A-Z][A-Za-z]*|partcombine[A-Z][A-Za-z]*|voiceOne|voiceTwo|change)\b|\\\\/;

/** Where `text` is music, not a string or a comment: a flag per place. */
function codeMask(text) {
  const mask = new Uint8Array(text.length + 1);
  let k = 0;
  while (k < text.length) {
    if (text[k] === '"') k = stringEnd(text, k);
    else if (text[k] === "%") k = skipBlank(text, k);
    else mask[k++] = 1;
  }
  return mask;
}

/** Whether `at` is at the top of the file, or right inside a \\score (\\book, \\bookpart), or among staves in << >>. */
function amongStaves(text, mask, at) {
  const open = [];
  for (let k = 0; k < at; k++) {
    if (!mask[k]) continue;
    if (text[k] === "{") open.push(k);
    else if (text[k] === "}") open.pop();
  }
  const inner = open.at(-1);
  return inner == null || /\\(score|book|bookpart)\s*$/.test(text.slice(Math.max(0, inner - 16), inner));
}

/** The `\\new PianoStaff` (GrandStaff) whose music starts at `at`: where its kind is written, or null. */
function pianoAround(text, at) {
  for (const m of [...text.slice(0, at).matchAll(/\\new\s+(PianoStaff|GrandStaff)\b/g)].reverse()) {
    let k = skipBlank(text, m.index + m[0].length);
    if (text[k] === "=") k = skipBlank(text, valueEnd(text, k + 1));
    if (commandAt(text, k) === "with") k = skipBlank(text, blockEnd(text, k + 5));
    if (k === at) return { at: m.index + m[0].length - m[1].length, kind: m[1] };
  }
  return null;
}

/**
 * `source` as the model reads its \\partCombine and \\autoChange: each it can
 * hold written out (see above). Answers { text, found: [{ kind, places,
 * names, split, piano }] }, `places` the stretches of `text` (the new one)
 * its notes are written in.
 */
function splitCombined(source) {
  const text = String(source ?? "");
  const mask = codeMask(text);
  const defs = definitions(text);
  const defAt = (p) => [...defs.entries()].find(([, d]) => p >= d.at && p < d.end);
  const usesOf = (name) => [...text.matchAll(new RegExp(`\\\\${name}(?![A-Za-z])`, "g"))].filter((m) => mask[m.index] && !defAt(m.index)).map((m) => m.index);
  const edits = [];
  const found = [];
  const taken = [];
  for (const m of text.matchAll(COMBINE_RE)) {
    const p = m.index;
    if (!mask[p] || taken.some(([a, b]) => p >= a && p < b)) continue;
    // In a variable: where it is used, once, is where its staff is.
    const def = defAt(p);
    let site = p;
    if (def) {
      const uses = usesOf(def[0]);
      if (uses.length !== 1) continue;
      site = uses[0];
    }
    const combine = /^partc/i.test(m[1]);
    let k = skipBlank(text, p + m[0].length);
    if (combine) {
      const a = [k, musicEnd(text, k)];
      const b = [skipBlank(text, a[1]), 0];
      b[1] = musicEnd(text, b[0]);
      if (a[1] <= a[0] || b[1] <= b[0]) continue;
      // The music of each part, its variables' too: nothing in it the model cannot hold.
      const parts = [a, b].map(([x, y]) => text.slice(x, y));
      const used = usedDefinitions(parts.join(" "), defs);
      if ([...parts, ...used.map((name) => defs.get(name).text)].some((t) => COMBINE_MODES.test(t) || COMBINE_ONE.test(t))) continue;
      const nameOf = ([x, y]) => {
        const name = commandAt(text, x);
        return name && defs.has(name) && y === x + 1 + name.length ? name : null;
      };
      const names = [nameOf(a), nameOf(b)];
      edits.push({ from: p, to: a[0], insert: "<< " }, { from: a[1], to: b[0], insert: " \\\\ " }, { from: b[1], to: b[1], insert: " >>" });
      found.push({ kind: "combine", places: [a, b, ...used.map((name) => [defs.get(name).at, defs.get(name).end])], ...(names.some(Boolean) ? { names } : {}) });
      taken.push([p, b[1]]);
    } else {
      // \\autoChange [pitch] music: below that pitch (middle C), the lower staff.
      let split = null;
      const word = /^[a-z]+[',]*/.exec(text.slice(k, k + 16))?.[0];
      if (word && /^[a-g]/.test(word) && commandAt(text, k) == null) {
        const after = skipBlank(text, k + word.length);
        if ("{<\\".includes(text[after] ?? "")) {
          split = word;
          k = after;
        }
      }
      const music = [k, musicEnd(text, k)];
      if (music[1] <= music[0]) continue;
      const used = usedDefinitions(text.slice(...music), defs);
      if ([text.slice(...music), ...used.map((name) => defs.get(name).text)].some((t) => COMBINE_MODES.test(t) || COMBINE_ONE.test(t))) continue;
      const piano = pianoAround(text, site);
      if (!piano && !amongStaves(text, mask, site)) continue;
      edits.push({ from: p, to: k, insert: "" });
      // In a piano staff: a staff of its own, the piano's \\with on it; alone: a staff.
      if (piano) edits.push({ from: piano.at, to: piano.at + piano.kind.length, insert: "Staff" });
      else edits.push({ from: site, to: site, insert: "\\new Staff " });
      found.push({ kind: "auto", places: [music, ...used.map((name) => [defs.get(name).at, defs.get(name).end])], split, piano: Boolean(piano) });
      taken.push([p, music[1]]);
    }
  }
  if (!found.length) return { text, found };
  edits.sort((x, y) => x.from - y.from || x.to - y.to);
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += text.slice(at, e.from) + e.insert;
    at = e.to;
  }
  out += text.slice(at);
  // A place of the source, in the new text: a start after what is put in there, an end before it.
  const moved = (x, end) => x + edits.filter((e) => e.to < x || (e.to === x && !(end && e.from === x))).reduce((sum, e) => sum + e.insert.length - (e.to - e.from), 0);
  for (const f of found) f.places = f.places.map(([x, y]) => [moved(x, false), moved(y, true)]);
  return { text: out, found };
}

/**
 * The staves `found` made marked (see above), in `placed`, each found by its
 * notes: false when one cannot be — the text is read otherwise then.
 */
function markCombined(score, parsed, placed, spans, found) {
  const notes = (st) => st.events.filter((ev) => ev.k === "Note" || ev.k === "Rest");
  for (const f of found) {
    const inside = (ev) => spans?.[ev.i] && f.places.some(([x, y]) => spans[ev.i][0] >= x && spans[ev.i][0] < y);
    const ks = parsed.staves.map((st, k) => k).filter((k) => parsed.staves[k].kind === "Notes" && notes(parsed.staves[k]).some(inside));
    // One staff, all of whose notes it writes.
    if (ks.length !== 1 || !notes(parsed.staves[ks[0]]).every(inside) || parsed.staves[ks[0]].lyrics) return false;
    const lanes = placed[ks[0]];
    const head = lanes[0];
    if (!head || head.ossias || head.raw != null || head.rawPart) return false;
    if (f.kind === "combine") {
      if (lanes.length > 2) return false;
      if (lanes.length === 1) lanes.push({ voice: 2, events: rests(score, 0, lengthOf(head)) });
      head.combine = f.names ? { names: f.names } : {};
    } else {
      if (lanes.length > 1 || head.events.some((ev) => ev.cross)) return false;
      head.autoChange = { ...(f.split ? { split: f.split } : {}), ...(f.piano ? { piano: true } : {}) };
      delete head.id;
    }
  }
  return true;
}

/** Whether lane `s` is on a staff of two parts, `\\partCombine`. */
export function isCombined(score, s) {
  return Boolean(score.staves[upperOf(score, s)]?.combine);
}

/** Whether lane `s` is one voice spread over a piano's two staves, `\\autoChange`. */
export function isAutoChange(score, s) {
  return Boolean(score.staves[upperOf(score, s)]?.autoChange);
}

/** The part lane `s` is on a \\partCombine staff: 1 or 2; 0 on any other. */
export function partOfLane(score, s) {
  return isCombined(score, s) ? voiceOf(score, s) : 0;
}

const COMBINE_VOICES = "A \\partCombine staff holds its two parts, part I and part II: no other voice";
const AUTO_VOICES = "\\autoChange spreads one voice over the piano's two staves: it holds no other voice";
const AUTO_CLEFS = "\\autoChange keeps its staves' clefs, treble over bass";
const AUTO_CROSS = "\\autoChange sends its notes from one staff to the other itself";
const COMBINE_CROSS = "The parts of \\partCombine stay on their staff";
const COMBINE_WORDS = "Words go under a staff of one part: not under \\partCombine or \\autoChange";

/** Starts of a lane's events, and where it ends. */
function eventTimes(events) {
  const at = [];
  let t = 0;
  for (const ev of events) {
    at.push(t);
    t += ticksOf(ev);
  }
  return { at, end: t };
}

/**
 * Which notes and rests of two parts the engraver draws when it combines
 * them, as its part combiner does (eui-score's combine.rs): [shownI, shownII],
 * a flag per event. The parts are cut where both start something; a stretch
 * is set apart (both drawn), as one note or one chord (part I's drawn), as
 * a solo (the part playing drawn), or as rests (part I's, or part II's where
 * part I's are spacers and its own are not).
 */
export function combinedShown(partI, partII) {
  const a = eventTimes(partI);
  const b = eventTimes(partII);
  const cuts = [...new Set([0, Math.max(a.end, b.end), ...[...a.at, a.end].filter((t) => b.at.includes(t) || t >= b.end), ...[...b.at, b.end].filter((t) => t >= a.end)])].sort((x, y) => x - y);
  const shownI = partI.map(() => false);
  const shownII = partII.map(() => false);
  const allRests = (list, events) => list.every((i) => events[i].rest);
  const sorted = (ev) => [...new Set(ev.pitches.map((p) => `${p.d}:${p.alter}`))].sort().join(" ");
  for (let n = 0; n + 1 < cuts.length; n++) {
    const [t0, t1] = [cuts[n], cuts[n + 1]];
    const ia = a.at.map((t, i) => i).filter((i) => a.at[i] >= t0 && a.at[i] < t1);
    const ib = b.at.map((t, i) => i).filter((i) => b.at[i] >= t0 && b.at[i] < t1);
    const show = (list, flags) => list.forEach((i) => (flags[i] = true));
    let state;
    if (!ib.length && !allRests(ia, partI)) state = "soloI";
    else if (!ia.length && !allRests(ib, partII)) state = "soloII";
    else if (!ia.length || !ib.length) state = "rests";
    else if (allRests(ia, partI) && allRests(ib, partII)) state = "rests";
    else if (allRests(ib, partII)) state = "soloI";
    else if (allRests(ia, partI)) state = "soloII";
    else if (ia.length !== 1 || ib.length !== 1 || ticksOf(partI[ia[0]]) !== ticksOf(partII[ib[0]]) || partI[ia[0]].rest || partII[ib[0]].rest) state = "apart";
    else {
      const [x, y] = [partI[ia[0]], partII[ib[0]]];
      const ds = (ev) => ev.pitches.map((p) => p.d);
      const chords = Math.min(...ds(x)) >= Math.max(...ds(y)) && Math.max(...ds(x)) - Math.min(...ds(y)) <= 8 && Boolean(x.tie) === Boolean(y.tie) && Boolean(x.tuplet) === Boolean(y.tuplet);
      state = sorted(x) === sorted(y) ? "one" : chords ? "one" : "apart";
    }
    if (state === "apart") {
      show(ia, shownI);
      show(ib, shownII);
    } else if (state === "soloII") show(ib, shownII);
    else if (state === "rests") {
      const spacers = (list, events) => list.every((i) => events[i].spacer);
      if (spacers(ia, partI) && !spacers(ib, partII)) show(ib, shownII);
      else show(ia, shownI);
    } else show(ia, shownI);
  }
  // A spacer is never drawn.
  return [shownI.map((x, i) => x && !partI[i].spacer), shownII.map((x, i) => x && !partII[i].spacer)];
}

/**
 * The items of a \\partCombine staff's two parts marked: one the engraver does
 * not draw is `hidden`, and `partner` is the item drawn for it — the other
 * part's at the same moment (or the one sounding then).
 */
function markParts(score, items, from, middle) {
  const first = items[from]?.staff;
  const second = items[middle]?.staff;
  if (first == null || second == null) return;
  const [laneI, laneII] = [score.staves[first], score.staves[second]];
  const [shownI, shownII] = combinedShown(laneI.events, laneII.events);
  const atI = eventTimes(laneI.events).at;
  const atII = eventTimes(laneII.events).at;
  const itemI = new Map();
  const itemII = new Map();
  for (let k = from; k < items.length; k++) (k < middle ? itemI : itemII).set(items[k].index, k);
  const partner = (at, t, shown, item) => {
    let best = -1;
    at.forEach((x, i) => {
      if (x <= t && shown[i] && item.has(i)) best = i;
    });
    return best >= 0 ? item.get(best) : null;
  };
  for (let k = from; k < items.length; k++) {
    const it = items[k];
    const one = k < middle;
    if ((one ? shownI : shownII)[it.index] ?? true) continue;
    it.hidden = true;
    const t = (one ? atI : atII)[it.index];
    const other = one ? partner(atII, t, shownII, itemII) : partner(atI, t, shownI, itemI);
    if (other != null) it.partner = other;
  }
}

/** The item drawn for item `k` of `toLilyPond`: itself, or the one a note drawn once for both parts stands for. */
export function drawnItem(items, k) {
  const it = items[k];
  return it?.hidden && it.partner != null ? it.partner : k;
}

/** The lower staff's rest for each of an \\autoChange voice's events: drawn where its note is not there. */
function echoItems(score, s) {
  const split = midiOfPitchName(score.staves[s].autoChange?.split) ?? 60;
  return score.staves[s].events.map((ev, index) => {
    const low = ev.rest ? null : Math.min(...ev.pitches.map((p) => midiKey(p.d, p.alter)));
    const drawn = ev.rest ? !ev.spacer : low >= split;
    return { staff: s, index, echo: true, ...(drawn ? {} : { hidden: true }) };
  });
}

/** The MIDI key of a LilyPond pitch name (c', fis, bes,,), or null. */
function midiOfPitchName(name) {
  const m = /^([a-g])((?:is|es|s)*)([',]*)$/.exec(String(name ?? ""));
  if (!m) return null;
  const alter = (m[2].match(/is/g) ?? []).length - (m[2].match(/es|(?<![ei])s/g) ?? []).length;
  const octave = (m[3].match(/'/g) ?? []).length - (m[3].match(/,/g) ?? []).length;
  return 48 + NATURAL[NAMES.indexOf(m[1])] + alter + 12 * octave;
}

// ---- The metre changed anywhere (#408) -------------------------------------------------------
//
// The engraver reads a \\time or a \\partial wherever it is written: in the
// middle of a bar, after the first bar, in one staff only. Unless the staves
// keep their own timing (\\enablePolymeter), each applies to every staff at
// that moment, the first staff's first. The model keeps what they make of
// the bars:
//
// - a \\time at the start of a bar: a change of metre there, as before;
// - a \\time `pos` ticks into bar b: bar b ends when it is as long as the new
//   metre's bar, or at once when it is longer already — its own length
//   (`len`), `timeAt: pos` — and the new metre from bar b + 1;
// - a \\partial T at the start of bar b: a bar of T (`len`, `partialAt: 0`);
//   `pos` into it: a bar of pos + T (`partialAt: pos`).
//
// They are written back where they were, in the first staff (oddWriting),
// when the bars still say the same; else the bar is written \\partial its
// length at its start, which any bar can be.

/**
 * Every staff's real \\time and \\partial with the moment it is written at
 * (ticks): [{ at, k, time, parts, ticks, staff }], in order, one of each kind
 * a moment — the first staff's (in `order`).
 */
function metreMoments(parsed, order) {
  const out = [];
  for (const k of order) {
    const st = parsed.staves[k];
    if (!["Notes", "Drums", "Tab"].includes(st.kind)) continue;
    let t = 0;
    let from = 0;
    let end = 0;
    for (const ev of st.events) {
      if (ev.k === "Voices") {
        from = t;
        end = t;
      } else if (ev.k === "VoiceNext") {
        end = Math.max(end, t);
        t = from;
      } else if (ev.k === "VoicesEnd") t = Math.max(end, t);
      else if (ev.k === "Note" || ev.k === "Rest") t += ev.full ? ev.ticks * Math.max(1, ev.count) : ev.ticks;
      else if (ev.k === "Time" && !ev.bar) out.push({ at: t, k: "Time", time: ev.time, parts: (ev.time_parts ?? []).filter((p) => p > 0), staff: k });
      else if (ev.k === "Partial") out.push({ at: t, k: "Partial", ticks: ev.ticks, staff: k });
    }
  }
  const sorted = out.map((m, n) => [m, n]).sort((x, y) => x[0].at - y[0].at || x[1] - y[1]).map(([m]) => m);
  return sorted.filter((m, n) => !sorted.slice(0, n).some((o) => Math.abs(o.at - m.at) < 1e-6 && o.k === m.k));
}

/** A \\time or \\partial of `metreMoments` made the score's bars. */
function applyMoment(score, m) {
  const b = barAt(score, m.at);
  const pos = m.at - barStart(score, b);
  const at0 = pos < 1e-6;
  if (m.k === "Partial") {
    if (m.ticks <= 0) return;
    setChange(score, b, "len", (at0 ? 0 : pos) + m.ticks);
    setChange(score, b, "partialAt", at0 ? 0 : pos);
    return;
  }
  const parts = m.parts.length > 1 ? m.parts : null;
  const was = timeAt(score, b);
  if (at0) {
    // At a bar line: a change of metre there, unless it says the metre again.
    const lastTime = (score.changes ?? []).filter((c) => c.time && c.bar < b).pop();
    const wasParts = (lastTime ? lastTime.parts : score.timeParts) ?? [];
    if (m.time[0] !== was[0] || m.time[1] !== was[1] || String(parts ?? []) !== String(wasParts)) setChange(score, b, "time", m.time);
    setChange(score, b, "parts", parts);
    return;
  }
  const len = Math.max(pos, (WHOLE * m.time[0]) / m.time[1]);
  if (m.time[0] === was[0] && m.time[1] === was[1] && len === barLength(score, b)) return;
  setChange(score, b, "len", len);
  setChange(score, b, "timeAt", pos);
  setChange(score, b + 1, "time", m.time);
  setChange(score, b + 1, "parts", parts);
}

/**
 * How bar `b` of its own length is written, when it is one a \\time or a
 * \\partial made: { kind: "time", pos, time } — the \\time where it was, in
 * the first staff, the next bar's metre; or { kind: "partial", pos, ticks };
 * null for a cadenza or a bar a bar line ends.
 */
export function oddBarWriting(score, b) {
  return isOddBar(score, b) ? oddWriting(score, b) : null;
}

function oddWriting(score, b) {
  const c = changeAt(score, b);
  if (!c?.len || c.cadenza != null || (c.timeAt == null && c.partialAt == null)) return null;
  const from = barStart(score, b);
  const at = starts(score.staves[firstMusic(score)] ?? { events: [] });
  const hits = (pos) => pos < 1e-6 || at.some((x) => Math.abs(x - from - pos) < 1e-6);
  if (c.timeAt != null) {
    const next = changeAt(score, b + 1);
    if (next?.time && c.timeAt > 0 && c.timeAt <= c.len && c.len === Math.max(c.timeAt, (WHOLE * next.time[0]) / next.time[1]) && hits(c.timeAt)) {
      return { kind: "time", pos: c.timeAt, time: next.time, parts: next.parts ?? null };
    }
  }
  const pos = c.partialAt != null && c.partialAt < c.len && hits(c.partialAt) ? c.partialAt : 0;
  const ticks = c.len - pos;
  return ticks % (WHOLE / 128) === 0 ? { kind: "partial", pos, ticks } : null;
}

// ---- Reading eui-score's parse back ---------------------------------------------------------

/** What the editor says of a piece of several movements (#359): engraved, edited in the text. */
const MOVEMENTS = "several movements (one \\score after another): edit them one at a time in the text";
/** What the editor says of \\afterGrace when the engraver does not hand its notes over. */
const AFTER_GRACE_UNREAD = "grace notes after a note (\\afterGrace)";
/** The parse's breath marks, by their glyph, as the model names them. */
const BREATHS_READ = { breathMarkComma: "breathe", caesura: "caesura" };

/**
 * What the engraver's warnings (Parsed.warnings) name as passed over — a
 * layout setting (`\\override Stem.direction`), a `\\layout` block, a header
 * field no title prints — each once: what a rewrite leaves out. A movement
 * the engraver could not set is not a setting (see MOVEMENTS).
 */
export function passedOver(warnings) {
  return shortList(passedOverAll(warnings));
}

/** A list of names, past six the first five and how many more. */
const shortList = (list) => (list.length > 6 ? [...list.slice(0, 5), `${list.length - 5} more`] : list);

/** Every name passedOver gives, none left out. */
function passedOverAll(warnings) {
  const names = new Set();
  for (const w of warnings ?? []) {
    if (/^movement \d|^the lyrics of movement/.test(w)) continue;
    // Kept by the model (readPage) and written back, whether the engraver draws them or not.
    if (/^\\paper's ((max-)?systems-per-page|(odd|even)(Header|Footer)Markup) /.test(w)) continue;
    names.add(w.replace(/:.*$/, "").replace(/ (is|are) not (drawn|read|engraved|set|words this prints).*$/, "").replace(/ outside the music$/, "").trim());
  }
  return [...names].filter(Boolean);
}

/** A clef's name by the parse's `[sign, line, octave]`. */
const CLEF_NAMES = Object.fromEntries(Object.entries(CLEF_SHAPES).map(([name, shape]) => [shape.join(","), name]));

/** Whether two lists of changes of key, from `start`, set the same keys at the same places. */
function sameKeys(score, start, a, b) {
  const plain = (list) => {
    let now = start;
    return list.filter((m) => m.key !== now && ((now = m.key), true)).map((m) => `${m.bar}:${m.pos}:${m.key}`).join(" ");
  };
  return plain(a) === plain(b);
}

/** Whether two lists of changes of metre, from `start`, set the same metres in the same bars. */
function sameTimes(start, a, b) {
  const plain = (list) => {
    let now = String(start);
    return list.filter((m) => String(m.time) !== now && ((now = String(m.time)), true)).map((m) => `${m.bar}:${m.time}`).join(" ");
  };
  return plain(a) === plain(b);
}

/** A grace note from the parse, `[pitches, value, dots, fingers]`, as the model keeps it. */
function graceOf([pitches, base, dots, fingers]) {
  const g = { pitches: pitches.map(([d, alter]) => ({ d, alter })), base, dots };
  if (fingers?.length) g.fingers = fingers.map(([text, dir, head, circled]) => ({ text, dir, head: head ?? null, circled }));
  return g;
}

/**
 * A line of chord names from its parse: each chord a rest as long as it
 * holds, its symbol and its \chordmode spelling; N.C. for `r`, nothing for
 * `s`. Read once the music's metre is known: a chord over a bar line is cut
 * there, the line going on after it.
 */
function chordLine(score, staff, unsupported) {
  const out = { name: staff.name ?? "", short: staff.short ?? "", instrument: "", clef: "treble", chords: true, events: [] };
  const tuplet = lineTuplets();
  for (const ev of staff.events) {
    ev.unsupported.forEach((u) => unsupported.add(u));
    if (ev.k !== "Note" && ev.k !== "Rest") continue;
    const ticks = ev.ticks * Math.max(1, ev.count ?? 1);
    const at = lengthOf(out);
    // A chord in a tuplet keeps it: written in its \\tuplet again.
    if (ev.tuplet) {
      if (ev.tuplet_outer) unsupported.add("a tuplet in a tuplet in a line of chord names");
      const written = String(ev.chord_text ?? "").replace(/^([a-g](?:is|es|s)*[',]*|r)\d*\.*(?:\*\d+)?/, "$1");
      const chord = ev.k === "Rest" ? (ev.spacer ? "" : "N.C.") : symbolOfChordmode(written) ?? symbolOfName(ev.chord_name);
      out.events.push(makeEvent({ base: ev.base, dots: ev.dots, tuplet: tuplet(ev), chord, ...(written && ev.k !== "Rest" ? { chordmode: written } : {}) }));
      continue;
    }
    if (ev.k === "Rest" && (ev.spacer || ev.full)) {
      out.events.push(...rests(score, at, ticks));
      continue;
    }
    const written = String(ev.chord_text ?? "").replace(/^([a-g](?:is|es|s)*[',]*|r)\d*\.*(?:\*\d+)?/, "$1");
    const chord = ev.k === "Rest" ? "N.C." : symbolOfChordmode(written) ?? symbolOfName(ev.chord_name);
    const read = makeEvent({ base: ev.base, dots: ev.dots, chord, ...(written ? { chordmode: written } : {}) });
    if (at + ticks > nextBarLine(score, at) + 1e-6 || notated(ev.base, ev.dots) !== ticks) out.events.push(...pieces(score, read, at, ticks, "whole"));
    else out.events.push(read);
  }
  return out;
}

/**
 * A score from `score_json`'s answer, or `{ unsupported: [...] }` naming
 * what it uses that this model does not keep — so the page edits the text
 * instead of losing it.
 */
export function fromParsed(parsed, source = null, { spans = parsed?.spans ?? null, parse = null, combined = null } = {}) {
  // \\partCombine and \\autoChange: read from the text the engraver answers for them in
  // the model's terms (see splitCombined), when `parse` (score_json, with the spans) is at hand.
  if (parse && !combined && source != null && COMBINE_ONE.test(source)) {
    const split = splitCombined(source);
    if (split.found.length) {
      try {
        const inner = parse(split.text);
        const read = fromParsed(inner, split.text, { spans: inner.spans ?? null, combined: split.found });
        if (!read.missed) return read;
      } catch {}
    }
  }
  // A text the engraver could not read (`name = \\partCombine …`, which only the model's reading gets through).
  if (!parsed) return { unsupported: ["a text the engraver cannot read"] };
  const unsupported = new Set();
  // What the model reads and does not keep: the first edit writes the text without it.
  const lost = new Set();
  // The commands written before each note that the model keeps as written (\\override, \\set …).
  const before = keptCommands(source, spans);
  // The \\tweak written on what follows a note (an articulation, words…), with it.
  const tweaked = postTweaks(source, spans);
  // Sizes set by a command the model keeps (\\tiny, \\small …): the notes after it are kept as they are.
  const keptSizes = [...before.values()].flat().some((text) => KEPT_SIZES.includes(text.slice(1)));
  if ((parsed.warnings ?? []).some((w) => /^movement \d/.test(w))) unsupported.add(MOVEMENTS);
  const score = { header: { ...parsed.header }, key: 0, time: [4, 4], tempo: null, group: "none", groups: [], staves: [], repeats: [], changes: [] };
  score.paper = paperFrom(parsed.paper);
  // The headers, the footers and the systems a page: read from the text, which keeps them.
  if (source != null) Object.assign(score.paper, readPage(source));
  // An engraver that reads \\afterGrace but does not hand its notes over
  // (a parse without `after_graces`): the text keeps them, the model would not.
  if (source != null && /\\afterGrace\b/.test(source) && !parsed.staves.some((st) => st.events.some((ev) => "after_graces" in ev))) {
    unsupported.add(AFTER_GRACE_UNREAD);
  }
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
  // Each staff's lanes, in the source's order. Lines of chord names are read
  // after the music, whose metre, pickup and repeats they follow.
  const placed = [];
  const isLine = (st) => st.kind === "ChordNames" || st.kind === "Figures";
  // An ossia after the staves of music too: it follows their metre, and is kept on its staff (see ossiaOf).
  const rank = (st) => (isLine(st) ? 2 : st.kind === "Ossia" ? 1 : 0);
  const order = parsed.staves.map((_, k) => k).sort((x, y) => rank(parsed.staves[x]) - rank(parsed.staves[y]));
  // Each staff's real \\time and \\partial, applied to every staff where it is written (#408), unless
  // the staves keep their own timing (\\enablePolymeter): the first staff's reading applies them as it goes.
  const polymeter = Boolean(parsed.paper?.polymeter);
  const moments = polymeter ? [] : metreMoments(parsed, order);
  const initial = { time: moments.find((m) => m.at === 0 && m.k === "Time") ?? null, partial: moments.find((m) => m.at === 0 && m.k === "Partial") ?? null };
  const pending = moments.filter((m) => m.at > 0);
  // The engraver's numbers for the notes of every staff but the ossias: an ossia's own are the others.
  const musicNumbers = new Set(parsed.staves.filter((st) => st.kind !== "Ossia").flatMap((st) => st.events.map((ev) => ev.i)));
  for (const k of order) {
    const staff = parsed.staves[k];
    if (staff.kind === "ChordNames" || staff.kind === "Figures") {
      placed[k] = [(staff.kind === "Figures" ? figureLine : chordLine)(score, staff, unsupported)];
      continue;
    }
    const drums = staff.kind === "Drums";
    // A tablature (\\new TabStaff): a staff of notes, drawn as frets on strings.
    const tab = staff.kind === "Tab";
    const ossia = staff.kind === "Ossia";
    const kinds = { FretBoards: "guitar chord diagrams" };
    if (staff.kind !== "Notes" && !drums && !tab && !ossia) unsupported.add(kinds[staff.kind] ?? "a staff of another kind");
    const out = { name: staff.name ?? "", short: staff.short ?? "", instrument: drums ? "" : staff.instrument ?? "", clef: drums ? "percussion" : "treble", events: [] };
    if (drums) out.drums = true;
    if (tab) out.tab = true;
    // `\new Staff = "down"`: the name \change Staff goes to.
    if (staff.id) out.id = staff.id;
    // Voices 2 to 4, `<< { … } \\ { … } \\ { … } >>`: each its own lane, rests where it is silent.
    const others = [2, 3, 4].map((voice) => ({ voice, events: [] }));
    // Which voice a part is: the one the engraver gave it (\voiceThree…), else counted.
    const laneFor = (voice) => (voice >= 2 ? others[voice - 2] : out);
    let lane = out;
    let voices = 0;
    const pad = (target, upto, spacer = false) => target.events.push(...rests(score, lengthOf(target), upto - lengthOf(target), spacer));
    // The lanes a block of voices writes in: one it leaves out is drawn as nothing there (voices inside a voice, #408).
    const inBlock = new Set();
    let started = false;
    const tuplets = new Map();
    let key = null;
    let mode = null;
    let time = null;
    // This staff's own changes of key and metre after its start, as it writes them:
    // the same as the score's, or its own (`keys`, `times`).
    const ownKeys = [];
    const ownTimes = [];
    // An \ottava waiting for its lane's next note or rest.
    const ottavas = new Map();
    // Each lane's stems and beaming, as its notes last said.
    const switches = new Map();
    // A cadenza's length, from its \\cadenzaOn: its notes and rests, up to its \\cadenzaOff.
    const cadenzas = new Map();
    if (first) {
      let open = null;
      for (const ev of staff.events) {
        if (ev.k === "CadenzaOn") open = { ev, ticks: 0 };
        else if (ev.k === "CadenzaOff" && open) {
          cadenzas.set(open.ev, open.ticks);
          open = null;
        } else if (open && ["Voices", "VoiceNext"].includes(ev.k)) open.ticks = NaN;
        else if (open && (ev.k === "Note" || ev.k === "Rest")) open.ticks += ev.ticks * (ev.full ? Math.max(1, ev.count) : 1);
      }
    }
    // Where the open cadenza started in its bar.
    let cadenzaAt = null;
    for (const ev of staff.events) {
      // The metre's changes up to here, wherever they are written.
      if (first && started) while (pending.length && pending[0].at <= lengthOf(lane) + 1e-6) applyMoment(score, pending.shift());
      // A cadenza is kept as a bar of its own length.
      // A cadenza is kept as a bar of its own length; cue notes as notes drawn small (`cue`).
      // Notes set smaller (\\tiny …) are kept with the command that sets them, read from the text.
      const sized = (u) => u === "notes set smaller" && keptSizes;
      ev.unsupported.filter((u) => u !== "a cadenza" && u !== "cue notes" && !sized(u)).forEach((u) => unsupported.add(u));
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
      if (k === "CadenzaOn" || k === "CadenzaOff") {
        // \\cadenzaOn … \\cadenzaOff: the first staff's make its bar as long as its notes, then end it.
        if (!first) continue;
        const b = barAt(score, here);
        if (k === "CadenzaOn") {
          const ticks = cadenzas.get(ev);
          if (!Number.isFinite(ticks) || cadenzaAt) unsupported.add("a cadenza in voices, or one left open");
          else if (ticks > 0) {
            cadenzaAt = { bar: b, pos: here - barStart(score, b) };
            setChange(score, b, "len", cadenzaAt.pos + ticks);
            setChange(score, b, "cadenza", cadenzaAt.pos);
          }
        } else cadenzaAt = null;
        continue;
      }
      if (k === "Clef" && (drums || tab)) continue;
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
          else if (!drums) ownKeys.push({ bar: b, pos, key: ev.fifths, ...(named ? { mode: named } : {}) });
        } else if (first) {
          const same = ev.fifths === scoreKeyAt(score, bar - 1, Infinity) && (named ?? "major") === modeAt(score, bar - 1, Infinity);
          setChange(score, bar, "key", same ? null : ev.fifths);
          setChange(score, bar, "mode", same ? null : named);
        } else if (!drums) ownKeys.push({ bar, pos: 0, key: ev.fifths, ...(named ? { mode: named } : {}) });
      } else if (k === "Time" && ev.bar === "default") {
        // A 4/4 the engraver puts in where nothing says the metre: not in the text.
        continue;
      } else if (k === "Time" && ev.bar === "shown") {
        // \\set Staff.timeSignatureFraction: the metre this staff draws, its bars as long as the others'.
        if (!started && !drums) out.shownTime = ev.time;
        else unsupported.add("a drawn metre (timeSignatureFraction) changed after a staff's start");
      } else if (k === "Time" && started && !polymeter && (first || bar < 0)) {
        // The score's change, applied as the first staff's reading reaches it (see metreMoments).
        continue;
      } else if (k === "Time") {
        const added = (ev.time_parts ?? []).filter((p) => p > 0);
        if (!started) {
          time = ev.time;
          // An additive metre at the start, 2+3/8: its parts, to be written again.
          if (first) score.timeParts = added.length > 1 ? added : null;
        } else if (bar < 0) unsupported.add("a change of metre inside a bar");
        else if (first) {
          const was = timeAt(score, bar);
          // The metre's parts in force before: the last change of metre's, or the start's.
          const lastTime = (score.changes ?? []).filter((c) => c.time && c.bar < bar).pop();
          const wasParts = (lastTime ? lastTime.parts : score.timeParts) ?? [];
          if (bar > 0 && (ev.time[0] !== was[0] || ev.time[1] !== was[1] || String(added.length > 1 ? added : []) !== String(wasParts))) setChange(score, bar, "time", ev.time);
          // An added-up metre, 2+2+3/8: its parts, written again.
          if (bar > 0) setChange(score, bar, "parts", added.length > 1 ? added : null);
        } else {
          // Its bars must last as long as the first staff's: the engraver lines them up.
          const want = timeAt(score, bar);
          if (ev.time[0] * want[1] !== want[0] * ev.time[1] && !isOddBar(score, bar)) unsupported.add("staves whose bars last differently");
          ownTimes.push({ bar, time: ev.time, ...(added.length > 1 ? { parts: added } : {}) });
        }
      } else if (k === "Tempo") {
        if (!started) {
          if (first) score.tempo = ev.tempo;
        } else if (bar < 0) {
          // Inside a bar: the first staff's, before the note it falls at.
          const b = barAt(score, here);
          if (first) score.midTempos = [...(score.midTempos ?? []), { bar: b, pos: here - barStart(score, b), tempo: { text: ev.tempo.text ?? "", base: ev.tempo.base || 4, bpm: ev.tempo.bpm || 0 } }];
        } else if (first) {
          if (bar === 0) score.tempo = ev.tempo;
          else setChange(score, bar, "tempo", { text: ev.tempo.text ?? "", base: ev.tempo.base || 4, bpm: ev.tempo.bpm || 0 });
        }
      } else if (k === "Partial") {
        // A pickup: the first staff's is the score's, the others' the same. Later, the score's (see metreMoments).
        if (started && !polymeter) continue;
        if (started) unsupported.add("a pickup after the first note");
        else if (first) score.pickup = ev.ticks;
        else if (ev.ticks !== (score.pickup ?? 0)) unsupported.add("staves whose pickups differ");
      } else if (k === "Mark") {
        // A mark over a bar line: a jump over the end of the bar before it
        // (or of the last bar), else the bar's own mark.
        if (!first) continue;
        // How the engraver draws it (a box, an offset…) rides before its words: kept by the \\set or \\override that says so, not its words.
        if (ev.mark?.text) ev.mark = { ...ev.mark, text: ev.mark.text.replace(/^\u0001\S*\s?/, "") };
        const jump = Object.keys(JUMPS).find((id) => JUMPS[id] === ev.mark?.text);
        const own = ev.mark?.glyph === "segno" ? "segno" : ev.mark?.glyph === "coda" ? "coda" : /^[A-Z]{1,2}$/.test(ev.mark?.text ?? "") ? "letter" : null;
        // Words of its own (\mark "Trio", \mark \markup \bold "Allegro"): kept as words.
        const words = !own && !jump && !ev.mark?.glyph && ev.mark?.text ? { text: ev.mark.text, ...(ev.mark.italic ? { italic: true } : {}), ...(ev.mark.bold ? { bold: true } : {}) } : null;
        if (!own && !jump && !words) {
          unsupported.add("a mark this editor does not name");
          continue;
        }
        if (bar < 0) {
          // Inside a bar: before the note it falls at.
          const b = barAt(score, here);
          score.midMarks = [...(score.midMarks ?? []), { bar: b, pos: here - barStart(score, b), ...(jump ? { jump } : own ? { mark: own } : { words }) }];
        } else if (jump && bar > 0) setChange(score, bar - 1, "jump", jump);
        else if (own) setChange(score, bar, "mark", own);
        else setChange(score, bar, "words", words);
      } else if (k === "Compress") {
        // \\compressMMRests (or \\compressEmptyMeasures, skipBars): bars of rest gathered.
        score.compress = true;
      } else if (k === "Voices") {
        if (voices) unsupported.add("voices inside voices");
        voices = 1;
        inBlock.clear();
        for (const other of others) pad(other, lengthOf(out));
      } else if (k === "VoiceNext") {
        voices++;
        lane = laneFor(voices);
      } else if (k === "VoicesEnd") {
        voices = 0;
        lane = out;
        const upto = Math.max(lengthOf(out), ...others.map(lengthOf));
        pad(out, upto);
        for (const other of others) pad(other, upto, !inBlock.has(other));
      } else if (["RepeatStart", "RepeatEnd", "VoltaStart", "VoltaEnd", "Bar"].includes(k)) {
        // Repeat signs, where they fall in bars — the first staff's are the score's.
        if (!first) continue;
        let at = bar >= 0 ? bar : barAt(score, here) + 0.5;
        const marks = { RepeatStart: ["start"], RepeatEnd: ["end"], VoltaStart: ["volta"], VoltaEnd: ["volta-end"], Bar: { ".|:": ["start"], ":|.": ["end"], ":|.|:": ["end", "start"] }[ev.bar] ?? [] }[k];
        // A bar line inside a bar (or a repeat's end, `}`) ends that bar there, as the engraver
        // ends it: a bar of its own length, the metre going on after it.
        if (bar < 0 && (k === "Bar" || k === "RepeatEnd")) {
          const b = barAt(score, here);
          setChange(score, b, "len", here - barStart(score, b));
          at = b + 1;
        }
        if (marks.length && !Number.isInteger(at)) unsupported.add("a repeat inside a bar");
        // A bar line of another kind between bars (a double one, a final one before a coda, a
        // dashed one…): the bar after it keeps it; a plain one only after a cadenza, which has none.
        const plainAfterCadenza = ev.bar === "|" && changeAt(score, at - 1)?.cadenza != null;
        if (k === "Bar" && !marks.length && at > 0 && (ev.bar !== "|" || plainAfterCadenza)) setChange(score, at, "line", ev.bar);
        for (const mark of marks) signs.push({ mark, at, times: ev.times ?? null });
      } else if (k === "Note" || k === "Rest") {
        if (!started) {
          started = true;
          if (first) {
            score.key = key ?? 0;
            if (mode) score.mode = mode;
            // No \\time or \\partial here: another staff's at the start is every staff's.
            if (time == null && initial.time) {
              time = initial.time.time;
              score.timeParts = initial.time.parts.length > 1 ? initial.time.parts : null;
            }
            if (!(score.pickup > 0) && initial.partial) score.pickup = initial.partial.ticks;
            score.time = time ?? [4, 4];
          } else {
            // A staff in a key of its own (a horn in E♭), or a metre of its own
            // whose bars last as long as the others' (6/8 beside 3/4).
            if ((key ?? 0) !== score.key && !drums) out.key = key ?? 0;
            const own = time ?? (polymeter ? [4, 4] : score.time);
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
        if (voices) inBlock.add(lane);
        const ottava = ottavas.get(lane);
        ottavas.delete(lane);
        if (k === "Rest" && ev.full) {
          const whole = rests(score, lengthOf(lane), ev.ticks * Math.max(1, ev.count));
          if (ottava != null && whole.length) whole[0].ottava = ottava;
          // A breath or a text span on a bar's rest: on its first rest, or its last.
          if (whole.length && ev.span_start != null) whole[0].spanStart = ev.span_start;
          if (whole.length && ev.span_stop) whole[whole.length - 1].spanEnd = true;
          if (whole.length && BREATHS_READ[ev.breath]) whole[whole.length - 1].breath = BREATHS_READ[ev.breath];
          if (ev.cross) for (const r of whole) r.cross = ev.cross;
          if (whole.length && before.get(ev.i)?.length) whole[0].before = [...before.get(ev.i)];
          if (ossia && musicNumbers.has(ev.i)) for (const r of whole) r.mirror = true;
          lane.events.push(...whole);
          continue;
        }
        // A spacer or a rest stretched by a factor (s8*7, r4*3): rests filling its time, spacers stay spacers.
        if (k === "Rest" && !ev.tuplet && !ev.scale && ev.ticks !== notated(ev.base, ev.dots) && ev.ticks > 0) {
          const filled = rests(score, lengthOf(lane), ev.ticks, Boolean(ev.spacer));
          if (filled.length && ev.cross) for (const r of filled) r.cross = ev.cross;
          if (filled.length && before.get(ev.i)?.length) filled[0].before = [...before.get(ev.i)];
          if (ossia && musicNumbers.has(ev.i)) for (const r of filled) r.mirror = true;
          lane.events.push(...filled);
          continue;
        }
        let tuplet = null;
        if (ev.tuplet) {
          const [tid, n, d] = ev.tuplet;
          if (!tuplets.has(tid)) tuplets.set(tid, newId());
          tuplet = { id: tuplets.get(tid), n, d };
          // The tuplet around it, when they nest.
          if (ev.tuplet_outer) {
            const [oid, on, od] = ev.tuplet_outer;
            if (!tuplets.has(oid)) tuplets.set(oid, newId());
            tuplet.outer = { id: tuplets.get(oid), n: on, d: od };
          }
        }
        const all = ev.texts.map(([text, dir, italic, bold]) => ({ text, dir, ...(italic ? { italic: true } : {}), ...(bold ? { bold: true } : {}) }));
        // A chord diagram (\fret-diagram) is its shape, not words.
        const diagram = all.find((w) => w.text.startsWith(FRET_MARK));
        const texts = all.filter((w) => w !== diagram);
        // A short word above a note that reads as a chord is its chord symbol.
        const chordAt = texts.findIndex((w) => w.dir < 0 && !w.bold && isChordSymbol(w.text));
        const chord = chordAt >= 0 ? texts.splice(chordAt, 1)[0].text : ev.chord_name || "";
        // An open or a stopped hi-hat's sign comes with its drum.
        const scripts = drums ? ev.scripts.filter(([name]) => !["open", "stopped"].includes(name)) : ev.scripts;
        const arts = scripts.map(([name]) => name).filter((n) => SCRIPTS[n]);
        if (scripts.some(([name]) => !SCRIPTS[name])) unsupported.add("some articulations");
        const signs = ev.scripts.map(([name]) => name);
        const byKey = (key) => (key === 42 && signs.includes("stopped") ? "hhc" : key === 46 && !signs.includes("open") ? "hhho" : (DRUMS.find((x) => x.key === key) ?? MORE_DRUMS.find((x) => x.key === key))?.name);
        if (drums && ev.drums.some(([, key]) => !byKey(key))) unsupported.add("a drum this editor does not name");
        const read = makeEvent({
          rest: k === "Rest",
          pitches: drums ? ev.drums.map(([, key]) => drumPitch(byKey(key) ?? "sn")) : ev.pitches.map(([d, alter]) => ({ d, alter })),
          base: ev.base, dots: ev.dots, tuplet,
          tie: ev.tie, slurStart: ev.slur_on, slurEnd: ev.slur_off, dynamic: ev.dynamic ?? null,
          hairpin: ev.hairpin ?? null, hairpinEnd: ev.hairpin_end, arts, chord, texts,
          // An articulation written above (^) or below (_): -1 or 1, by its name.
          ...(scripts.some(([name, dir]) => SCRIPTS[name] && dir) ? { artDirs: Object.fromEntries(scripts.filter(([name, dir]) => SCRIPTS[name] && dir).map(([name, dir]) => [name, Math.sign(dir)])) } : {}),
          graces: (ev.graces ?? []).map(graceOf),
          grace: ev.grace ?? null, arpeggio: Boolean(ev.arpeggio), gliss: Boolean(ev.gliss), tremolo: ev.tremolo ?? 0,
          ...(ev.after_graces?.length
            ? { afterGraces: ev.after_graces.map(graceOf), afterAt: ev.after_at ?? AFTER_GRACE_AT }
            : {}),
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
          // Drawn on another staff, `\change Staff = "down"`: that staff's id.
          ...(ev.cross ? { cross: ev.cross } : {}),
          ...(diagram && k === "Note" ? { fret: diagram.text.slice(FRET_MARK.length), ...(diagram.dir > 0 ? { fretBelow: true } : {}) } : {}),
          // In an ossia, what only mirrors its staff's time: drawn as nothing there.
          ...(ossia && musicNumbers.has(ev.i) ? { mirror: true } : {}),
          // A cue note: another part's, drawn small and not played (\\new CueVoice, \\cueDuring).
          ...(ev.unsupported.includes("cue notes") ? { cue: true } : {}),
          // The \\override, \\set, \\tweak … written before it, as written.
          ...(before.get(ev.i)?.length ? { before: [...before.get(ev.i)] } : {}),
          ...(tweaked.get(ev.i)?.length ? { tweaks: tweaked.get(ev.i).map((x) => ({ ...x })) } : {}),
          // \\scaleDurations n/d: the written value, lasting n/d of itself.
          ...(Array.isArray(ev.scale) && ev.scale[0] > 0 && ev.scale[1] > 0 ? { scale: [ev.scale[0], ev.scale[1]] } : {}),
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
        if (!tuplet && !read.scale && at + ev.ticks > nextBarLine(score, at) + 1e-6) lane.events.push(...pieces(score, read, at, ev.ticks, "whole"));
        else lane.events.push(read);
      }
    }
    // A staff that changes key or metre apart from the first: its own changes, kept as its own.
    if (!first && !drums && started) {
      const derived = keyChanges(score, 0).map((m) => ({ ...m, key: Math.max(-7, Math.min(7, m.key + (out.key ?? score.key) - score.key)) }));
      if (!sameKeys(score, out.key ?? score.key, derived, ownKeys)) {
        out.keys = ownKeys;
        // Its first key's mode, when it is not the score's.
        if (mode && mode !== (score.mode ?? null)) out.mode = mode;
      }
    }
    if (!first && started && !sameTimes(out.time ?? score.time, timeChanges(score, 0), ownTimes)) out.times = ownTimes;
    // An \ottava with no note after it draws nothing.
    if (ottavas.size) lost.add("an \\ottava after the last note");
    if (staff.lyrics) {
      // Sung to a lower voice (\lyricsto "alto"): under that voice's notes, its name kept.
      const voice = staff.lyrics_voice ?? 1;
      const sung = laneFor(voice);
      if (voice > 1) {
        out.lyricsVoice = voice;
        const name = (staff.voices ?? []).find(([, v]) => v === voice)?.[0];
        if (name) out.lyricsName = name;
      }
      const skip = melismata(sung);
      [staff.lyrics, ...(staff.verses ?? [])].forEach((words, v) => {
        let k = 0;
        sung.events.forEach((ev, i) => {
          if (skip[i]) return;
          const syl = words[k++];
          if (syl && syl.text && syl.text !== "_") putSyllable(ev, v + 1, { text: syl.text, hyphen: syl.hyphen, extend: syl.extend });
        });
      });
    }
    // The voices up to the last that sounds: one before it that is silent stays, as rests.
    let kept = others.length;
    // Beside cue notes, a voice of rests is the part's own: its rests are kept.
    const besideCue = out.events.some((x) => x.cue);
    while (kept > 0 && !(others[kept - 1].events.length && (sounding(others[kept - 1].events) || (besideCue && kept === 1 && others[0].events.some((x) => x.rest && !x.spacer))))) kept--;
    for (const other of others.slice(0, kept)) pad(other, lengthOf(out));
    placed[k] = [out, ...others.slice(0, kept)];
    // What other staves write after the first one ends.
    if (first && started) while (pending.length) applyMoment(score, pending.shift());
    first = false;
  }
  // Each ossia, kept on the staff it stands over: its bars, its music, its \\with.
  const ossias = parsed.staves.map((st, k) => (st.kind === "Ossia" ? k : -1)).filter((k) => k >= 0);
  if (ossias.length) {
    const bodies = staffWiths(source).filter((w) => w.kind === "Staff" && /\balign(Above|Below)Context\b/.test(w.body ?? ""));
    ossias.forEach((k, n) => {
      const kept = bodies.length === ossias.length ? ossiaOf(score, placed[k], bodies[n].body, placed) : null;
      if (!kept) unsupported.add("an ossia");
      placed[k] = [];
    });
    // The groups, counted in staves without them.
    const shift = (at) => at - ossias.filter((k) => k < at).length;
    score.groups = score.groups.map((g) => ({ ...g, first: shift(g.first), last: shift(g.last) })).filter((g) => g.last >= g.first);
  }
  // Two parts on one staff, one voice over two: their staves marked, or the text read otherwise.
  if (combined && !markCombined(score, parsed, placed, spans, combined)) return { missed: true };
  // A staff kept as written (\\partCombine, \\autoChange): its text, the variables it uses, its notes shown.
  if (source != null && new RegExp(`\\\\(${RAW_COMMANDS.join("|")})\\b`).test(source)) keepRaw(score, parsed, placed, source, spans, unsupported);
  score.staves = placed.flat();
  // A staff whose notes go to another one needs a name to come back to.
  for (const u of staffLanes(score)) {
    if (!score.staves[u].id && voiceLanes(score, u).some((lane) => score.staves[lane].events.some((ev) => ev.cross))) staffId(score, u);
  }
  if (signs.length) {
    const repeats = repeatsFrom(signs);
    if (repeats) score.repeats = repeats;
    else unsupported.add("repeats this editor cannot follow");
  }
  if (unsupported.size) return { unsupported: [...unsupported] };
  if (!score.staves.length) return { unsupported: ["a piece with no staff"] };
  // What each staff's \\with says beside its names, the \\layout blocks, what \\paper says more: kept as written.
  // (An ossia's \\with is its own: see ossiaOf.)
  const isOssiaWith = (w) => /\balign(Above|Below)Context\b/.test(w.body ?? "");
  const withs = staffWiths(source).filter((w) => ["Staff", "DrumStaff", "TabStaff", "RhythmicStaff", "ChordNames", "FiguredBass"].includes(w.kind) && !isOssiaWith(w));
  const more = withs.map((w) => withMore(w.body));
  const plainStaves = parsed.staves.map((st, k) => k).filter((k) => parsed.staves[k].kind !== "Ossia");
  if (withs.length === plainStaves.length) plainStaves.forEach((k, n) => more[n] && placed[k][0] && (placed[k][0].withMore = more[n]));
  else if (more.some(Boolean)) lost.add("what a staff's \\with says beside its name");
  const layout = layoutBlocks(source);
  if (layout.length) score.layout = layout;
  const paper = paperMore(source);
  if (paper.length) score.paper.more = paper;
  // The layout settings the engraver passes over (\\override, \\set, \\with …) and the model does not keep.
  const held = {
    commands: placed.flat().flatMap((lane) => lane.events.flatMap((ev) => [...(ev.before ?? []), ...(ev.tweaks ?? []).map((x) => x.text)])),
    withs: withs.length === plainStaves.length ? more : [],
    layout,
    paper,
  };
  const settings = shortList(passedOverAll(parsed.warnings).filter((name) => !keptName(name, held)));
  if (settings.length) lost.add(`the settings the engraver passes over (${settings.join(", ")})`);
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
  for (const c of tempoMarks(score)) {
    const t = barStart(score, c.bar) + c.pos;
    const way = rampOf(c.tempo.text);
    if (way) begins.push({ t, way, target: c.tempo.bpm ? qpmOf(c.tempo) : null, before: Math.max(0, c.pos > 0 ? c.bar : c.bar - 1) });
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
  // A speed set inside a bar: from where it stands to the bar's end (the bars after it are its own).
  for (const m of score.midTempos ?? []) {
    if (!m.tempo.bpm) continue;
    const t0 = barStart(score, m.bar) + m.pos;
    const later = (score.midTempos ?? []).filter((x) => x.tempo.bpm && x.bar === m.bar && x.pos > m.pos).map((x) => barStart(score, x.bar) + x.pos);
    const t1 = Math.min(barStart(score, m.bar + 1), ...later, end);
    if (t1 > t0 && !out.some((r) => r.t0 < t1 && r.t1 > t0)) out.push({ t0, t1, q0: qpmOf(m.tempo), q1: qpmOf(m.tempo) });
  }
  return out.sort((x, y) => x.t0 - y.t0);
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
  refuseScaled(score, s);
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
  refuseScaled(score, s);
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
