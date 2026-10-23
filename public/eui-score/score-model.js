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

const NAMES = ["c", "d", "e", "f", "g", "a", "b"];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const SHARPS = [3, 0, 4, 1, 5, 2, 6];
const KEYS = { "-7": "ces", "-6": "ges", "-5": "des", "-4": "aes", "-3": "ees", "-2": "bes", "-1": "f", 0: "c", 1: "g", 2: "d", 3: "a", 4: "e", 5: "b", 6: "fis", 7: "cis" };
const CLEFS = ["treble", "bass", "alto", "tenor", "treble_8", "bass_8", "soprano", "percussion"];
const SCRIPTS = {
  staccato: "-.", accent: "->", tenuto: "--", marcato: "-^", staccatissimo: "-!", portato: "-_", fermata: "\\fermata",
  trill: "\\trill", prall: "\\prall", mordent: "\\mordent", turn: "\\turn",
};
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

/** Where each metre starts: [{ bar, start, len, time }], the first at bar 0. */
function metres(score) {
  const out = [{ bar: 0, start: 0, len: (WHOLE * score.time[0]) / score.time[1], time: score.time }];
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

/** The metre bar `b` is in. */
export function timeAt(score, b) {
  return metreOfBar(score, b).time;
}

/** What changes at the start of bar `b`, or null. */
export function changeAt(score, b) {
  return (score.changes ?? []).find((c) => c.bar === b) ?? null;
}

/** The score's key in bar `b`, as its changes leave it. */
function scoreKeyAt(score, b) {
  let key = score.key;
  for (const c of score.changes ?? []) if (c.bar <= b && c.key != null) key = c.key;
  return key;
}

/** The tempo in force in bar `b`: { text, base, bpm }, or null. */
export function tempoAt(score, b) {
  let tempo = score.tempo;
  for (const c of score.changes ?? []) if (c.bar <= b && c.tempo) tempo = { ...(tempo ?? {}), ...c.tempo, text: c.tempo.text ?? "" };
  return tempo;
}

/** The clef lane `s` is in during bar `b`. */
export function clefAt(score, s, b) {
  const staff = score.staves[upperOf(score, s)];
  let clef = staff.clef;
  for (const c of staff.clefs ?? []) if (c.bar <= b) clef = c.clef;
  return clef;
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
  let bpm = score.tempo?.bpm || 100;
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
  }
  if (s != null) refuseDrums(score, s);
  const lanes = (s == null ? score.staves.map((_, k) => k) : [s]).filter((lane) => !isDrums(score, lane));
  for (const lane of lanes) {
    const events = score.staves[lane].events;
    events.forEach((ev, i) => {
      if (s != null && (i < a || i > b)) return;
      if (!ev.rest) ev.pitches = ev.pitches.map((p) => transposePitch(p, steps, semitones));
      for (const g of ev.graces) g.pitches = g.pitches.map((p) => transposePitch(p, steps, semitones));
      if (s == null && ev.chord) ev.chord = transposeChord(ev.chord, steps, semitones);
    });
  }
}

/** A chord symbol's root and bass moved: "F#m7/C#" up a major second is "G#m7/D#". */
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

/** Rests filling `ticks` from `at`, cut at the bar lines. */
function rests(score, at, ticks) {
  const out = [];
  let t = at;
  const end = at + ticks;
  while (t < end - 1e-6) {
    const piece = Math.min(end, nextBarLine(score, t)) - t;
    for (const v of spellDuration(piece)) out.push(makeEvent({ base: v.base, dots: v.dots }));
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
 * key (fifths), time ([n, d]), bpm (0 for none), bars.
 */
export function fromTemplate(id, { title = "Untitled", composer = "", key = 0, time = [4, 4], bpm = 0, bars = 8 } = {}) {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error("no such template");
  if (!Number.isInteger(bars) || bars < 1 || bars > 500) throw new Error("a score has 1 to 500 bars");
  if (!Number.isInteger(key) || key < -7 || key > 7) throw new Error("no such key");
  // A drum kit alone has no key.
  const drumsOnly = template.staves.every((spec) => spec.instrument === "Drum kit");
  const score = { header: { title: title || "Untitled", composer }, key: drumsOnly ? 0 : key, time, tempo: bpm > 0 ? { text: "", base: 4, bpm } : null, group: template.group, groups: [], staves: [], repeats: [], changes: [] };
  const length = barStart(score, bars);
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
  staff.events.splice(a, b - a, ...fill);
  // A note cut before `from` was tied to its tail, which is gone now.
  const before = staff.events[a - 1];
  const after = staff.events[a];
  if (before?.tie && !sameNote(before, after)) before.tie = false;
  if (tidyUp) tidy(score, staff);
  return eventAt(staff, t);
}

const sameNote = (a, b) => Boolean(a && b && !a.rest && !b.rest && a.pitches.length === b.pitches.length && a.pitches.every((p, k) => p.d === b.pitches[k].d && p.alter === b.pitches[k].alter));

/** Rests side by side in a bar, with nothing on them, written as few as can be. */
export function tidy(score, staff) {
  const at = starts(staff);
  const out = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    out.push(...rests(score, run.start, run.ticks));
    run = null;
  };
  staff.events.forEach((ev, i) => {
    const plain = ev.rest && !ev.tuplet && !ev.dynamic && !ev.hairpin && !ev.hairpinEnd && !ev.texts.length && !ev.chord && !ev.arts.length && !ev.pedalOn && !ev.pedalOff;
    const sameBar = run && barAt(score, at[i]) === barAt(score, run.start);
    if (plain && sameBar) {
      run.ticks += ticksOf(ev);
      run.events.push(ev);
      return;
    }
    flush();
    if (plain) run = { start: at[i], ticks: ticksOf(ev), events: [ev] };
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
  setPitches(score, s, i, sortPitches(ev.pitches.map((q, j) => (j === k ? p : q))));
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
  setPitches(score, s, i, sortPitches(ev.pitches.map((q, j) => (j === k ? p : q))));
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
    ev.pitches = ev.pitches.filter((_, k) => k !== head);
    return;
  }
  Object.assign(ev, { rest: true, pitches: [], tie: false, slurStart: false, slurEnd: false, arts: [], lyric: null, graces: [], grace: null, arpeggio: false, gliss: false, tremolo: 0 });
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

/** A slur from event `a` to event `b`; on one note, takes away the slurs it starts or ends. */
export function toggleSlur(score, s, a, b) {
  const events = score.staves[s].events;
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  if (from === to) {
    const ev = events[from];
    if (ev.slurStart || ev.slurEnd) {
      // On a note a slur starts or ends at: the slur goes, both its ends.
      const open = ev.slurStart ? from : events.slice(0, from).findLastIndex((e) => e.slurStart);
      const close = ev.slurEnd ? from : events.findIndex((e, k) => k > from && e.slurEnd);
      if (open >= 0) events[open].slurStart = false;
      if (close >= 0) events[close].slurEnd = false;
      return;
    }
    // One note: slurred to the next one, as MuseScore does.
    const next = events.findIndex((e, k) => k > from && !e.rest);
    if (ev.rest || next < 0) throw new Error("a slur goes from a note to a later note");
    ev.slurStart = true;
    events[next].slurEnd = true;
    return;
  }
  if (events[from].rest || events[to].rest) throw new Error("a slur goes from a note to a note");
  events[from].slurStart = !events[from].slurStart;
  events[to].slurEnd = events[from].slurStart;
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

// ---- Ranges ---------------------------------------------------------------------

/** Events `a`…`b` of staff `s`, for a clipboard: content and duration, and the ticks they span. */
export function copy(score, s, a, b) {
  const staff = score.staves[s];
  const events = staff.events.slice(Math.min(a, b), Math.max(a, b) + 1);
  if (events.some((ev) => ev.tuplet)) throw new Error("tuplets cannot be copied yet");
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
  if (lane.events.some((ev) => ev.tuplet)) throw new Error("tuplets cannot be pasted yet");
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
// with the staff's settings — and, when it has a second voice, the lane right
// after it: { voice: 2, events }. Every edit on events works on a lane; what
// belongs to the staff (clef, name, key, lyrics) lives on its first lane.
// `score.group` brackets every staff; `score.groups` are the groups inside
// it, { kind, first, last } in staves (not lanes), possibly nested.

export function isLower(score, s) {
  return score.staves[s]?.voice === 2;
}

/** The staff's first lane, for any of its lanes. */
export function upperOf(score, s) {
  return isLower(score, s) ? s - 1 : s;
}

/** The staff's second voice's lane, or −1. */
export function lowerOf(score, s) {
  const u = upperOf(score, s);
  return isLower(score, u + 1) ? u + 1 : -1;
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
  return Math.max(-7, Math.min(7, scoreKeyAt(score, barAt(score, t)) + own));
}

/** A second voice on the staff of lane `s`, rests to begin with; answers its lane. */
export function addVoice(score, s) {
  const u = upperOf(score, s);
  if (!score.staves[u]) throw new Error("no such staff");
  if (lowerOf(score, u) >= 0) return u + 1;
  score.staves.splice(u + 1, 0, { voice: 2, events: rests(score, 0, lengthOf(score.staves[u])) });
  return u + 1;
}

/** The staff's second voice taken away, its notes with it. */
export function removeVoice(score, s) {
  const lower = lowerOf(score, s);
  if (lower < 0) throw new Error("this staff has one voice");
  score.staves.splice(lower, 1);
}

/** A bar of a second voice is written when something in it is: a note, or a rest with a mark. */
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
  const old = { time: score.time, changes: structuredClone(score.changes ?? []) };
  const from = barStart(old, b);
  const next = old.changes.find((c) => c.bar > b && c.time);
  const total = lengthOf(score.staves[0]);
  const to = next ? barStart(old, next.bar) : total;
  if (next && (to - from) % len !== 0) throw new Error(`the bars up to the next change of metre would not make whole bars of ${num}/${den}`);
  const grown = (next ? to - from : Math.ceil((to - from) / len) * len) - (to - from);
  for (const staff of score.staves) {
    const at = starts(staff);
    if (staff.events.some((ev, k) => ev.tuplet && at[k] >= from && at[k] < to)) throw new Error("move or remove the tuplets in those bars before changing the metre");
  }
  // Everything counted in bars, as times.
  const tick = (bar) => barStart(old, bar);
  const marks = old.changes.filter((c) => c.bar !== b).map((c) => ({ ...c, at: tick(c.bar) }));
  marks.push({ ...(old.changes.find((c) => c.bar === b) ?? {}), bar: b, at: from, time: [num, den] });
  marks.sort((x, y) => x.at - y.at);
  const repeats = (score.repeats ?? []).map((r) => ({ from: tick(r.from), to: tick(r.to + 1), ends: r.endings.map((_, k) => tick(r.to + 1 + r.endings.slice(0, k + 1).reduce((x, y) => x + y, 0))) }));
  const clefs = score.staves.map((staff) => (staff.clefs ?? []).map((c) => ({ ...c, at: tick(c.bar) })));
  // The new bars: each mark's bar counted in the new metres.
  const shift = (t) => (t > from ? t + grown : t);
  let seg = { bar: 0, at: 0, len: b === 0 ? len : (WHOLE * score.time[0]) / score.time[1] };
  const changes = [];
  for (const m of marks) {
    const at = shift(m.at);
    const rel = (at - seg.at) / seg.len;
    if (!Number.isInteger(rel)) throw new Error("the changes of key, tempo or clef there would fall inside bars: move them first");
    const bar = seg.bar + rel;
    const { at: _, ...change } = m;
    change.bar = bar;
    if (bar === 0) {
      score.time = change.time ?? score.time;
    } else {
      // A metre that is the one in force already is no change.
      if (change.time && change.time[0] === (seg.time ?? score.time)[0] && change.time[1] === (seg.time ?? score.time)[1]) delete change.time;
      if (Object.keys(change).length > 1) changes.push(change);
    }
    if (m.time) seg = { bar, at, len: (WHOLE * m.time[0]) / m.time[1], time: m.time };
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
    return { from: f, to: t, endings };
  });
  clefs.forEach((list, k) => {
    if (!list.length) return;
    score.staves[k].clefs = list.map((c) => {
      const at = shift(c.at);
      if (!isBarLine(score, at)) throw new Error("the changes of key, tempo or clef there would fall inside bars: move them first");
      return { bar: barAt(score, at), clef: c.clef };
    });
  });
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
  setChange(score, b, "key", to === scoreKeyAt(score, b - 1) ? null : to);
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
  if (clef && clef !== clefAt(score, s, b - 1)) staff.clefs = [...kept, { bar: b, clef }].sort((x, y) => x.bar - y.bar);
  if (!staff.clefs.length) delete staff.clefs;
}

export function addStaff(score, fields = {}) {
  score.staves.push(emptyStaff(score, fields));
  if (staffLanes(score).length > 1 && score.group === "none" && !(score.groups ?? []).length) score.group = "bracket";
}

/** The staff of lane `s` taken away, both its voices; the groups around it close up. */
export function removeStaff(score, s) {
  if (staffLanes(score).length < 2) throw new Error("a score keeps one staff at least");
  const u = upperOf(score, s);
  const n = staffNumber(score, u);
  score.staves.splice(u, lowerOf(score, u) >= 0 ? 2 : 1);
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
  }
  score.changes = (score.changes ?? []).filter((c) => c.bar < bars - 1);
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
  const after = { key: scoreKeyAt(score, b), time: timeAt(score, b), tempo: tempoAt(score, b) };
  const before = a > 0 ? { key: scoreKeyAt(score, a - 1), time: timeAt(score, a - 1), tempo: tempoAt(score, a - 1) } : { key: score.key, time: score.time, tempo: score.tempo };
  const own = changeAt(score, b + 1) ?? {};
  const clefsAfter = score.staves.map((staff, s) => (staff.voice === 2 ? null : clefAt(score, s, b)));
  const clefsBefore = score.staves.map((staff, s) => (staff.voice === 2 ? null : a > 0 ? clefAt(score, s, a - 1) : staff.clef));
  const from = barStart(score, a);
  const to = barStart(score, b + 1);
  for (const staff of score.staves) {
    const at = starts(staff);
    staff.events = staff.events.filter((_, k) => at[k] < from || at[k] >= to);
    mend(staff);
  }
  // The changes and clefs inside the bars go; those after them move back.
  const shift = (list) => (list ?? []).filter((c) => c.bar < a || c.bar > b).map((c) => (c.bar > b ? { ...c, bar: c.bar - count } : c));
  score.changes = shift(score.changes);
  // A break after a bar that goes, goes; those after the bars move back.
  score.breaks = Object.fromEntries(Object.entries(score.breaks ?? {}).filter(([bar]) => Number(bar) < a || Number(bar) > b).map(([bar, kind]) => [Number(bar) > b ? Number(bar) - count : Number(bar), kind]));
  score.staves.forEach((staff, s) => {
    if (staff.clefs) staff.clefs = shift(staff.clefs);
    if (staff.voice === 2 || b + 1 >= bars) return;
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

function eventText(ev) {
  const head = (p) => p.drum ?? spellPitch(p.d, p.alter);
  const notes = (pitches) => (pitches.length === 1 ? head(pitches[0]) : `<${pitches.map(head).join(" ")}>`);
  let out = "";
  if (ev.graces.length && !ev.rest) {
    const graces = ev.graces.map((g) => notes(g.pitches) + g.base + ".".repeat(g.dots));
    out += `\\${ev.grace ?? "grace"} ${graces.length === 1 ? graces[0] : `{ ${graces.join(" ")} }`} `;
  }
  out += ev.rest ? "r" : notes(ev.pitches);
  out += ev.base + ".".repeat(ev.dots);
  if (ev.tremolo && !ev.rest) out += `:${ev.tremolo}`;
  if (ev.tie && !ev.rest) out += "~";
  if (ev.slurStart) out += "(";
  if (ev.slurEnd) out += ")";
  if (ev.dynamic) out += `\\${ev.dynamic}`;
  if (ev.hairpinEnd) out += "\\!";
  if (ev.hairpin) out += ev.hairpin === "<" ? "\\<" : "\\>";
  for (const a of ev.arts) out += SCRIPTS[a] ?? "";
  if (ev.chord) out += `^${quote(ev.chord)}`;
  for (const t of ev.texts) out += `${t.dir > 0 ? "_" : "^"}${t.italic ? `\\markup \\italic ${quote(t.text)}` : quote(t.text)}`;
  if (ev.arpeggio && !ev.rest) out += "\\arpeggio";
  if (ev.gliss && !ev.rest) out += "\\glissando";
  // Let go before pressed again, when a note has both.
  if (ev.pedalOff) out += "\\sustainOff";
  if (ev.pedalOn) out += "\\sustainOn";
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
 * its lane and event. `open` lists bars of second voices to write even when
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
    const lower = lowerOf(score, s);
    const second = lower >= 0 ? staffBars(score, score.staves[lower], lower) : [];
    const bars = upper.map((bar, b) => {
      const other = second[b];
      const shown = other && (sounding(other.events) || open.some((o) => o.staff === lower && o.bar === b));
      items.push(...bar.items, ...(shown ? other.items : []));
      const top = staffNumber(score, s) === 0;
      const broken = top && b > 0 ? { line: "\\break ", page: "\\pageBreak " }[(score.breaks ?? {})[b - 1]] ?? "" : "";
      return broken + changesText(score, s, b) + (top ? markText(score, b) : "") + (shown ? `<< { ${bar.text} } \\\\ { ${other.text} } >>` : bar.text) + (top ? jumpText(score, b) : "");
    });
    const music = unfold ? playedOut(score, s, bars) : withRepeats(bars, repeats);
    const lastRepeat = !unfold && repeats.find((r) => r.endings.length === 0 && r.to === bars.length - 1);
    const name = staff.name ? `instrumentName = ${quote(staff.name)} ` : "";
    const short = staff.short ? `shortInstrumentName = ${quote(staff.short)} ` : "";
    const midi = staff.instrument && !staff.drums ? `midiInstrument = ${quote(staff.instrument)} ` : "";
    const tempo = s === 0 && score.tempo && (score.tempo.text || score.tempo.bpm) ? ` ${tempoText(score.tempo)}` : "";
    const clef = clefText(staff.clef);
    const time = staff.time ?? score.time;
    const settings = name + short + midi;
    // A piece that ends on a repeat's end keeps its :|. sign, not a final bar.
    const ending = lastRepeat ? "" : ' \\bar "|."';
    // Written pitch: a transposing instrument's staff, key and all, where it is read.
    const moved = written ? transpositionOf(staff) : null;
    const brace = moved ? `\\transpose c ${moved} {` : "{";
    // A drum staff: its strokes in \\drummode, with no clef and no key.
    const opening = staff.drums
      ? `\\new DrumStaff ${settings ? `\\with { ${settings}} ` : ""}\\drummode {\n  \\time ${timeText(score, time)}${tempo}`
      : `\\new Staff ${settings ? `\\with { ${settings}} ` : ""}${brace}\n  \\clef ${clef} \\key ${KEYS[keyOf(score, s)]} \\major \\time ${timeText(score, time)}${tempo}`;
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
  return { source: pageText(score) + (header ? `\\header { ${header} }\n` : "") + body + "\n", items };
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
  const words = String(text ?? "").trim();
  ev.texts = words ? [...kept, { text: words, dir: italic ? 1 : -1, italic }] : kept;
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
  if (c?.key != null && !drums) parts.push(`\\key ${KEYS[keyOf(score, s, barStart(score, b))]} \\major`);
  if (c?.time) parts.push(`\\time ${c.time[0]}/${c.time[1]}`);
  if (c?.tempo && staffNumber(score, s) === 0) parts.push(tempoText(c.tempo));
  if (c?.line) parts.unshift(`\\bar "${c.line}"`);
  return parts.length ? parts.join(" ") + " " : "";
}

/** A lane's music, a string per bar, with its events and items; a tuplet never leaves its bar. */
function staffBars(score, staff, s) {
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
    if (tid !== null && open === null) {
      current.parts.push(`\\tuplet ${ev.tuplet.n}/${ev.tuplet.d} {`);
      open = tid;
    }
    current.parts.push(eventText(ev));
    t += ticksOf(ev);
    if (Math.abs(t - barStart(score, bars.length + 1)) < 1e-6) close();
  });
  if (current.parts.length) close();
  return bars;
}

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
    let text = `\\repeat volta ${Math.max(2, r.endings.length)} { ${bars.slice(r.from, r.to + 1).join(" | ")} }`;
    let next = r.to + 1;
    if (r.endings.length) {
      const alts = r.endings.map((len) => {
        const ending = bars.slice(next, next + len).join(" | ");
        next += len;
        return `{ ${ending} }`;
      });
      text += ` \\alternative { ${alts.join(" ")} }`;
    }
    groups.push(text);
    b = next;
  }
  return groups.map((g, k) => (k > 0 && k % 4 === 0 ? "\n    " : "") + g).join(" | ").replace(/ \| \n {4}/g, " |\n    ");
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
    out.push({ from: open.from, to: open.to, endings: endings ?? [] });
    open = null;
    endings = null;
  };
  for (const { mark, at } of signs) {
    if (mark === "start") {
      if (open && open.to === null) return null;
      close();
      open = { from: at, to: null };
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
  const candidate = { from: next.from ?? r.from, to: next.to ?? r.to, endings: [...(next.endings ?? r.endings)] };
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
  const t = barStart(score, at);
  if (score.staves.some((staff) => t > lengthOf(staff))) throw new Error("no such bar");
  // What changes from bar `at` moves along: the new bars keep the metre before them.
  for (const c of score.changes ?? []) if (c.bar >= at) c.bar += count;
  for (const staff of score.staves) for (const c of staff.clefs ?? []) if (c.bar >= at) c.bar += count;
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

/** The part of the staff on lane `s`: that staff (and its second voice) alone, its name on top. */
export function partOf(score, s) {
  const upper = upperOf(score, s);
  const lower = lowerOf(score, upper);
  const lanes = lower >= 0 ? [upper, lower] : [upper];
  const part = JSON.parse(JSON.stringify(score));
  const staff = part.staves[upper];
  part.staves = lanes.map((lane) => part.staves[lane]);
  part.groups = [];
  part.group = "none";
  part.header = { ...part.header, instrument: staff.name || INSTRUMENTS[instrumentOf(score, upper)]?.name || "" };
  // The staff's name is the part's heading: not repeated before each line.
  part.staves[0] = { ...part.staves[0], name: "", short: "" };
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
    const passes = Math.max(2, r.endings.length);
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
  let bpm = score.tempo?.bpm || 100;
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
  const held = p.holds.filter((h) => h.at <= into).reduce((sum, h) => sum + h.ticks, 0);
  return ((into + held) / M_TICKS(p.base)) * (60 / p.bpm);
}

/** Every pass through a bar, in the order they sound: [{ bar, start, end, bpm, base, holds }], in seconds. */
export function playback(score) {
  let sec = 0;
  return playOrder(score).map((bar) => {
    const { bpm, base } = speedAt(score, bar);
    const start = sec;
    const pass = { bar, start, end: 0, bpm, base, holds: holdsIn(score, bar) };
    sec += intoPass(pass, barLength(score, bar));
    pass.end = sec;
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

/** The metronome's beats, every repeat played out: [{ sec, down }], `down` on each bar's first. */
export function beats(score, passes) {
  const out = [];
  for (const p of passes) {
    const [num, den] = timeAt(score, p.bar);
    for (let k = 0; k < num; k++) out.push({ sec: p.start + intoPass(p, (k * WHOLE) / den), down: k === 0 });
  }
  return out;
}

/** Each staff and the MIDI channel eui-score gives it: [{ lane, name, channel }], as it numbers them. */
export function channels(score) {
  return staffLanes(score).map((lane, k) => ({
    lane,
    name: score.staves[lane].name || `Staff ${k + 1}`,
    channel: score.staves[lane].drums ? 9 : k < 9 ? k : Math.min(15, k + 1),
  }));
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

const CLEF_NAMES = { "G,-2,0": "treble", "G,-2,-1": "treble_8", "F,2,0": "bass", "F,2,-1": "bass_8", "C,0,0": "alto", "C,2,0": "tenor", "C,-4,0": "soprano" };

/**
 * A score from `score_json`'s answer, or `{ unsupported: [...] }` naming
 * what it uses that this model does not keep — so the page edits the text
 * instead of losing it.
 */
export function fromParsed(parsed) {
  const unsupported = new Set();
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
    // A second voice, `<< { … } \\ { … } >>`: its own lane, rests where it is silent.
    const lower = { voice: 2, events: [] };
    let lane = out;
    let voices = 0;
    const pad = (target, upto) => target.events.push(...rests(score, lengthOf(target), upto - lengthOf(target)));
    let started = false;
    const tuplets = new Map();
    let key = null;
    let time = null;
    for (const ev of staff.events) {
      ev.unsupported.forEach((u) => unsupported.add(u));
      // A tuplet in a tuplet is engraved and played; the score tools write one level.
      if (ev.tuplet_outer) unsupported.add("a tuplet inside a tuplet");
      // Engraved and played; the score tools write two voices a staff, each on its own.
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
      if (k === "Clef" && drums) continue;
      if (k === "Clef") {
        const name = CLEF_NAMES[ev.clef.join(",")];
        if (!name) unsupported.add("this clef");
        if (!started || bar === 0) out.clef = name ?? "treble";
        else if (bar < 0) unsupported.add("a change of clef inside a bar");
        else {
          out.clefs = [...(out.clefs ?? []).filter((c) => c.bar !== bar), { bar, clef: name ?? "treble" }];
        }
      } else if (k === "Key") {
        if (!started) key = ev.fifths;
        else if (bar < 0) unsupported.add("a change of key inside a bar");
        else if (first) setChange(score, bar, "key", ev.fifths === scoreKeyAt(score, bar - 1) ? null : ev.fifths);
        else if (ev.fifths !== Math.max(-7, Math.min(7, scoreKeyAt(score, bar) + (out.key ?? score.key) - score.key))) unsupported.add("staves changing key apart");
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
      } else if (k === "Voices") {
        if (voices) unsupported.add("voices inside voices");
        voices = 1;
        pad(lower, lengthOf(out));
      } else if (k === "VoiceNext") {
        if (voices !== 1) unsupported.add("three voices on a staff");
        voices = 2;
        lane = lower;
      } else if (k === "VoicesEnd") {
        voices = 0;
        lane = out;
        const upto = Math.max(lengthOf(out), lengthOf(lower));
        pad(out, upto);
        pad(lower, upto);
      } else if (["RepeatStart", "RepeatEnd", "VoltaStart", "VoltaEnd", "Bar"].includes(k)) {
        // Repeat signs, where they fall in bars — the first staff's are the score's.
        if (!first) continue;
        const at = bar >= 0 ? bar : barAt(score, here) + 0.5;
        const marks = { RepeatStart: ["start"], RepeatEnd: ["end"], VoltaStart: ["volta"], VoltaEnd: ["volta-end"], Bar: { ".|:": ["start"], ":|.": ["end"], ":|.|:": ["end", "start"] }[ev.bar] ?? [] }[k];
        if (marks.length && !Number.isInteger(at)) unsupported.add("a repeat inside a bar");
        // A double bar line between sections: the bar after it keeps it.
        if (k === "Bar" && ev.bar === "||" && bar > 0) setChange(score, bar, "line", "||");
        for (const mark of marks) signs.push({ mark, at });
      } else if (k === "Note" || k === "Rest") {
        if (!started) {
          started = true;
          if (first) {
            score.key = key ?? 0;
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
        if (k === "Rest" && ev.full) {
          lane.events.push(...rests(score, lengthOf(lane), ev.ticks * Math.max(1, ev.count)));
          continue;
        }
        let tuplet = null;
        if (ev.tuplet) {
          const [tid, n, d] = ev.tuplet;
          if (!tuplets.has(tid)) tuplets.set(tid, newId());
          tuplet = { id: tuplets.get(tid), n, d };
        }
        const texts = ev.texts.map(([text, dir, italic]) => (italic ? { text, dir, italic: true } : { text, dir }));
        // A short word above a note that reads as a chord is its chord symbol.
        const chordAt = texts.findIndex((w) => w.dir < 0 && /^[A-G][#b♯♭]?(m|maj|min|dim|aug|sus|add|°|ø|\+)?[0-9]*(\/[A-G][#b♯♭]?)?$/.test(w.text));
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
        });
        // A note past its bar line, as the engraver cuts it: tied pieces.
        const at = lengthOf(lane);
        if (!tuplet && at + ev.ticks > nextBarLine(score, at) + 1e-6) lane.events.push(...pieces(score, read, at, ev.ticks, "whole"));
        else lane.events.push(read);
      }
    }
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
    if (lower.events.length && sounding(lower.events)) {
      pad(lower, lengthOf(out));
      score.staves.push(lower);
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
  return { score };
}
