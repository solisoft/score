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

/** Ticks in a whole note, as eui-score counts them: a dotted 32nd, and any of them in a triplet, quintuplet, sextuplet or septuplet, is a whole number. */
export const WHOLE = 26880;

const NAMES = ["c", "d", "e", "f", "g", "a", "b"];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const SHARPS = [3, 0, 4, 1, 5, 2, 6];
const KEYS = { "-7": "ces", "-6": "ges", "-5": "des", "-4": "aes", "-3": "ees", "-2": "bes", "-1": "f", 0: "c", 1: "g", 2: "d", 3: "a", 4: "e", 5: "b", 6: "fis", 7: "cis" };
const CLEFS = ["treble", "bass", "alto", "tenor", "treble_8", "bass_8", "soprano", "percussion"];
const SCRIPTS = { staccato: "-.", accent: "->", tenuto: "--", marcato: "-^", staccatissimo: "-!", portato: "-_", fermata: "\\fermata" };
export const DYNAMICS = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "sf", "sfz", "fp", "rfz"];
export const ARTICULATIONS = Object.keys(SCRIPTS);
/** Values, longest first, with their dots, a written duration may take. */
const VALUES = [1, 2, 4, 8, 16, 32].flatMap((base) => [2, 1, 0].map((dots) => ({ base, dots, ticks: notated(base, dots) }))).sort((a, b) => b.ticks - a.ticks);

// ---- Durations ------------------------------------------------------------

/** The ticks of a written value: `base` 1 (whole) … 32, with `dots`. */
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

export function barLength(score) {
  return (WHOLE * score.time[0]) / score.time[1];
}

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

/** A pitch moved: `how` is "step" (in the key), "semitone" or "octave". */
export function movePitch(p, how, by, fifths) {
  if (how === "octave") return { d: p.d + 7 * Math.sign(by), alter: p.alter };
  if (how === "semitone") return spellKey(fifths, midiKey(p.d, p.alter) + Math.sign(by), Math.sign(by));
  const d = p.d + Math.sign(by);
  return { d, alter: keyAlters(fifths)[mod7(d)] };
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
    dynamic: null, hairpin: null, hairpinEnd: false, arts: [], chord: "", texts: [], lyric: null, ...fields,
  };
}

function cloneEvent(ev, fields = {}) {
  return makeEvent({ ...structuredClone({ ...ev, id: undefined }), ...fields, id: newId() });
}

/** Rests filling `ticks` from `at`, cut at the bar lines. */
function rests(score, at, ticks) {
  const out = [];
  const bar = barLength(score);
  let t = at;
  const end = at + ticks;
  while (t < end) {
    const piece = Math.min(end, (Math.floor(t / bar) + 1) * bar) - t;
    for (const v of spellDuration(piece)) out.push(makeEvent({ base: v.base, dots: v.dots }));
    t += piece;
  }
  return out;
}

export function emptyStaff(score, fields = {}) {
  return { name: "", short: "", instrument: "acoustic grand", clef: "treble", events: rests(score, 0, barLength(score) * barsOf(score)), ...fields };
}

/** A new score: one staff of four empty bars. */
export function newScore(fields = {}) {
  const score = { header: { title: "Untitled", composer: "" }, key: 0, time: [4, 4], tempo: null, group: "none", staves: [], repeats: [], ...fields };
  score.staves.push({ name: "", short: "", instrument: "acoustic grand", clef: "treble", events: rests(score, 0, barLength(score) * 4) });
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
  return first ? Math.round(lengthOf(first) / barLength(score)) : 4;
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
  const bar = barLength(score);
  const out = [];
  let t = at;
  const end = at + ticks;
  while (t < end) {
    const piece = Math.min(end, (Math.floor(t / bar) + 1) * bar) - t;
    for (const v of spellDuration(piece)) out.push(cloneEvent(ev, { base: v.base, dots: v.dots, tuplet: null }));
    t += piece;
  }
  const keepsStart = role !== "tail";
  const keepsEnd = role !== "head";
  out.forEach((p, k) => {
    const last = k === out.length - 1;
    p.tie = !p.rest && (last ? (role === "head" ? true : Boolean(ev.tie)) : true);
    if (!(k === 0 && keepsStart)) Object.assign(p, { slurStart: false, dynamic: null, hairpin: null, arts: [], chord: "", texts: [], lyric: null });
    if (!(last && keepsEnd)) Object.assign(p, { slurEnd: false, hairpinEnd: false });
  });
  return out;
}

/** Every staff made `ticks` long at least, in whole bars of rests. */
export function ensureLength(score, ticks) {
  const bar = barLength(score);
  const want = Math.ceil(ticks / bar) * bar;
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
  const bar = barLength(score);
  const at = starts(staff);
  const out = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    out.push(...rests(score, run.start, run.ticks));
    run = null;
  };
  staff.events.forEach((ev, i) => {
    const plain = ev.rest && !ev.tuplet && !ev.dynamic && !ev.hairpin && !ev.hairpinEnd && !ev.texts.length && !ev.chord && !ev.arts.length;
    const sameBar = run && Math.floor(at[i] / bar) === Math.floor(run.start / bar);
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

/** The pitch of the last note before event `i`, for a letter to land near. */
export function previousPitch(score, s, i) {
  const events = score.staves[s].events;
  for (let k = i - 1; k >= 0; k--) if (!events[k].rest) return events[k].pitches[0].d;
  const clef = score.staves[s].clef;
  return clef.startsWith("bass") ? 3 : clef === "alto" ? 7 : clef === "tenor" ? 5 : 13;
}

/** Event `i` moved by step, semitone or octave — one head `head` of a chord, or all. */
export function move(score, s, i, how, by, head = -1) {
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("select a note");
  const moved = ev.pitches.map((p, k) => (head < 0 || k === head ? movePitch(p, how, by, score.key) : p));
  if (!moved.every(reachable)) throw new Error("that is as far as it goes");
  ev.pitches = sortPitches(moved);
}

/** Event `i` given step `step` (C = 0 … B = 6) near where it was; a rest becomes that note. `add` adds it above a chord. */
export function letter(score, s, i, step, add = false, head = -1) {
  const ev = noteOf(score, s, i);
  if (ev.rest) {
    const p = nearestPitch(step, previousPitch(score, s, i), score.key);
    Object.assign(ev, { rest: false, pitches: [p] });
    return;
  }
  if (add) {
    const top = Math.max(...ev.pitches.map((p) => p.d));
    let d = top - mod7(top) + step;
    if (d <= top) d += 7;
    const p = { d, alter: keyAlters(score.key)[mod7(d)] };
    if (!reachable(p)) throw new Error("that is as far as it goes");
    if (!ev.pitches.some((q) => q.d === p.d)) ev.pitches = sortPitches([...ev.pitches, p]);
    return;
  }
  const k = head >= 0 && head < ev.pitches.length ? head : 0;
  const p = nearestPitch(step, ev.pitches[k].d, score.key);
  ev.pitches = sortPitches(ev.pitches.map((q, j) => (j === k ? p : q)));
}

export function setAlter(score, s, i, alter, head = -1) {
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("select a note");
  ev.pitches = ev.pitches.map((p, k) => (head < 0 || k === head ? { d: p.d, alter: Math.max(-2, Math.min(2, alter)) } : p));
}

/** A note — or one head of a chord — taken away; a note becomes a rest of its length. */
export function remove(score, s, i, head = -1) {
  const ev = noteOf(score, s, i);
  if (ev.rest) return;
  if (head >= 0 && ev.pitches.length > 1) {
    ev.pitches = ev.pitches.filter((_, k) => k !== head);
    return;
  }
  Object.assign(ev, { rest: true, pitches: [], tie: false, slurStart: false, slurEnd: false, arts: [], lyric: null });
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

export function setChordSymbol(score, s, i, text) {
  noteOf(score, s, i).chord = text.trim();
}

export function setLyric(score, s, i, text, hyphen = false, extend = false) {
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("a syllable goes under a note");
  ev.lyric = text.trim() ? { text: text.trim(), hyphen, extend } : null;
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
  const d = n === 3 ? 2 : 4;
  const base = ev.base * d;
  if (base > 32) throw new Error("too short to split");
  const tuplet = { id: newId(), n, d };
  const group = Array.from({ length: n }, (_, k) =>
    k === 0 ? cloneEvent(ev, { base, dots: 0, tuplet, tie: false }) : makeEvent({ base, dots: 0, tuplet }),
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

export function setKey(score, fifths) {
  score.key = Math.max(-7, Math.min(7, fifths));
}

/** A new time signature: every staff laid out again in its bars. */
export function setTime(score, num, den) {
  const old = score.time;
  const oldBar = barLength(score);
  const newBar = (WHOLE * num) / den;
  const moved = (score.repeats ?? []).map((r) => {
    const at = (bars) => (bars * oldBar) / newBar;
    const from = at(r.from);
    const to = at(r.to + 1) - 1;
    const endings = r.endings.map((n) => at(n));
    if (![from, to, ...endings].every(Number.isInteger)) throw new Error("the repeats would fall inside bars: remove them before changing the metre");
    return { from, to, endings };
  });
  const laid = score.staves.map((staff) => {
    const at = starts(staff);
    return staff.events.map((ev, k) => ({ ev, t: at[k] }));
  });
  score.time = [num, den];
  const bar = barLength(score);
  for (const [s, staff] of score.staves.entries()) {
    const total = lengthOf(staff);
    staff.events = rests(score, 0, Math.ceil(total / bar) * bar);
    for (const { ev, t } of laid[s]) {
      if (ev.rest && !ev.dynamic && !ev.texts.length) continue;
      if (ev.tuplet) {
        score.time = old;
        throw new Error("move or remove the tuplets before changing the metre");
      }
      const { id, base, dots, ...content } = ev;
      write(score, s, t, ticksOf(ev), content);
    }
  }
  ensureLength(score, Math.max(...score.staves.map(lengthOf)));
  score.repeats = moved;
}

export function addStaff(score, fields = {}) {
  score.staves.push(emptyStaff(score, fields));
  if (score.staves.length > 1 && score.group === "none") score.group = "bracket";
}

export function removeStaff(score, s) {
  if (score.staves.length < 2) throw new Error("a score keeps one staff at least");
  score.staves.splice(s, 1);
}

/** Bars of rests added at the end of every staff. */
export function addBars(score, count = 1) {
  ensureLength(score, (barsOf(score) + count) * barLength(score));
}

/** The last bar taken away when it holds nothing but rests. */
export function removeLastBar(score) {
  const bar = barLength(score);
  const bars = barsOf(score);
  if (bars < 2) throw new Error("a score keeps one bar at least");
  const from = (bars - 1) * bar;
  for (const staff of score.staves) {
    const at = starts(staff);
    if (staff.events.some((ev, k) => at[k] >= from && !ev.rest)) throw new Error("the last bar is not empty");
  }
  if (repeatAt(score, bars - 1)) throw new Error("the last bar is in a repeat: remove the repeat first");
  for (const staff of score.staves) {
    const at = starts(staff);
    staff.events = staff.events.filter((_, k) => at[k] < from);
  }
}

// ---- LilyPond ---------------------------------------------------------------------

const quote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function eventText(ev) {
  let out = ev.rest ? "r" : ev.pitches.length === 1 ? spellPitch(ev.pitches[0].d, ev.pitches[0].alter) : `<${ev.pitches.map((p) => spellPitch(p.d, p.alter)).join(" ")}>`;
  out += ev.base + ".".repeat(ev.dots);
  if (ev.tie && !ev.rest) out += "~";
  if (ev.slurStart) out += "(";
  if (ev.slurEnd) out += ")";
  if (ev.dynamic) out += `\\${ev.dynamic}`;
  if (ev.hairpinEnd) out += "\\!";
  if (ev.hairpin) out += ev.hairpin === "<" ? "\\<" : "\\>";
  for (const a of ev.arts) out += SCRIPTS[a] ?? "";
  if (ev.chord) out += `^${quote(ev.chord)}`;
  for (const t of ev.texts) out += `${t.dir > 0 ? "_" : "^"}${quote(t.text)}`;
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

function lyricText(staff) {
  const words = [];
  const skip = melismata(staff);
  for (const [i, ev] of staff.events.entries()) {
    if (!skip[i]) {
      const l = ev.lyric;
      if (l) {
        const text = /^[\p{L}\p{N}'’.,!?;:]+$/u.test(l.text) ? l.text : quote(l.text);
        words.push(text + (l.hyphen ? " --" : "") + (l.extend ? " __" : ""));
      } else {
        words.push("_");
      }
    }
  }
  while (words.length && words[words.length - 1] === "_") words.pop();
  return words.length ? words.join(" ") : "";
}

/**
 * The score as LilyPond, absolute pitches, a bar check at every bar line.
 * `items` maps each note and rest, in the order eui-score numbers them, to
 * its staff and event.
 */
export function toLilyPond(score) {
  const items = [];
  const header = Object.entries(score.header).filter(([, v]) => v).map(([k, v]) => `${k} = ${quote(v)}`).join(" ");
  const repeats = score.repeats ?? [];
  const staves = score.staves.map((staff, s) => {
    const bars = staffBars(score, staff, s, items);
    const music = withRepeats(bars, repeats);
    const lastRepeat = repeats.find((r) => r.endings.length === 0 && r.to === bars.length - 1);
    const name = staff.name ? `instrumentName = ${quote(staff.name)} ` : "";
    const short = staff.short ? `shortInstrumentName = ${quote(staff.short)} ` : "";
    const midi = staff.instrument ? `midiInstrument = ${quote(staff.instrument)} ` : "";
    const tempo = s === 0 && score.tempo && (score.tempo.text || score.tempo.bpm)
      ? ` \\tempo ${score.tempo.text ? quote(score.tempo.text) + " " : ""}${score.tempo.bpm ? `${score.tempo.base} = ${score.tempo.bpm}` : ""}`.trimEnd()
      : "";
    const clef = CLEFS.includes(staff.clef) ? (staff.clef.includes("_") ? `"${staff.clef}"` : staff.clef) : "treble";
    const settings = name + short + midi;
    // A piece that ends on a repeat's end keeps its :|. sign, not a final bar.
    const ending = lastRepeat ? "" : ' \\bar "|."';
    let out = `  \\new Staff ${settings ? `\\with { ${settings}} ` : ""}{\n    \\clef ${clef} \\key ${KEYS[score.key]} \\major \\time ${score.time[0]}/${score.time[1]}${tempo}\n    ${music}${ending}\n  }`;
    const lyrics = lyricText(staff);
    if (lyrics) out += `\n  \\addlyrics { ${lyrics} }`;
    return out;
  });
  const group = { brace: "\\new PianoStaff", bracket: "\\new StaffGroup", choir: "\\new ChoirStaff" }[score.group] ?? "";
  const body = staves.length > 1 || group ? `${group ? group + " " : ""}<<\n${staves.join("\n")}\n>>` : staves[0].replace(/^ {2}/gm, "");
  return { source: (header ? `\\header { ${header} }\n` : "") + body + "\n", items };
}

/** A staff's music, a string per bar; a tuplet never leaves its bar. */
function staffBars(score, staff, s, items) {
  const bar = barLength(score);
  const bars = [];
  let current = [];
  let t = 0;
  let open = null;
  staff.events.forEach((ev, i) => {
    items.push({ staff: s, index: i });
    const tid = ev.tuplet?.id ?? null;
    if (open !== null && tid !== open) {
      current.push("}");
      open = null;
    }
    if (tid !== null && open === null) {
      current.push(`\\tuplet ${ev.tuplet.n}/${ev.tuplet.d} {`);
      open = tid;
    }
    current.push(eventText(ev));
    t += ticksOf(ev);
    if (Math.abs(t / bar - Math.round(t / bar)) < 1e-9) {
      if (open !== null) current.push("}");
      open = null;
      bars.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) bars.push(current.join(" ") + (open !== null ? " }" : ""));
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

/** The bar a time (ticks) is in. */
export function barAt(score, t) {
  return Math.floor(t / barLength(score));
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

/** `count` bars of rests put in every staff before bar `at`; the repeats after it move along. */
export function insertBars(score, at, count) {
  const bar = barLength(score);
  for (const staff of score.staves) {
    const t = at * bar;
    if (t > lengthOf(staff)) throw new Error("no such bar");
    const i = t === lengthOf(staff) ? staff.events.length : eventAt(staff, t);
    if (i < 0) throw new Error("bars must start at a bar line");
    staff.events.splice(i, 0, ...rests(score, t, count * bar));
  }
  for (const r of score.repeats ?? []) {
    if (r.from >= at) r.from += count;
    if (r.to >= at) r.to += count;
  }
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
  const score = { header: { ...parsed.header }, key: 0, time: [4, 4], tempo: null, group: "none", staves: [], repeats: [] };
  // Where the first staff's repeat signs fall, in bars: the score's repeats.
  const signs = [];
  const kinds = { Brace: "brace", Bracket: "bracket", Choir: "choir" };
  if (parsed.groups.length > 1) unsupported.add("nested staff groups");
  if (parsed.groups[0]) score.group = kinds[parsed.groups[0].kind] ?? "none";
  let first = true;
  for (const staff of parsed.staves) {
    if (staff.kind !== "Notes") unsupported.add(staff.kind === "Tab" ? "tablature" : staff.kind === "Drums" ? "drum staves" : "chord-name staves");
    const out = { name: staff.name ?? "", short: staff.short ?? "", instrument: staff.instrument ?? "", clef: "treble", events: [] };
    let started = false;
    const tuplets = new Map();
    let key = null;
    let time = null;
    for (const ev of staff.events) {
      ev.unsupported.forEach((u) => unsupported.add(u));
      const k = ev.k;
      if (k === "Clef") {
        const name = CLEF_NAMES[ev.clef.join(",")];
        if (!name) unsupported.add("this clef");
        if (started) unsupported.add("a change of clef");
        else out.clef = name ?? "treble";
      } else if (k === "Key") {
        if (started && ev.fifths !== key) unsupported.add("a change of key");
        key = ev.fifths;
      } else if (k === "Time") {
        if (started && (ev.time[0] !== time?.[0] || ev.time[1] !== time?.[1])) unsupported.add("a change of metre");
        time = ev.time;
      } else if (k === "Tempo") {
        if (started) unsupported.add("a change of tempo");
        else if (first) score.tempo = ev.tempo;
      } else if (["RepeatStart", "RepeatEnd", "VoltaStart", "VoltaEnd", "Bar"].includes(k)) {
        // Repeat signs, where they fall in bars — the first staff's are the score's.
        if (!first) continue;
        const at = lengthOf(out) / barLength(score);
        const marks = { RepeatStart: ["start"], RepeatEnd: ["end"], VoltaStart: ["volta"], VoltaEnd: ["volta-end"], Bar: { ".|:": ["start"], ":|.": ["end"], ":|.|:": ["end", "start"] }[ev.bar] ?? [] }[k];
        if (marks.length && !Number.isInteger(at)) unsupported.add("a repeat inside a bar");
        for (const mark of marks) signs.push({ mark, at });
      } else if (k === "Note" || k === "Rest") {
        if (!started) {
          started = true;
          if (first) {
            score.key = key ?? 0;
            score.time = time ?? [4, 4];
          } else if ((key ?? 0) !== score.key || (time?.[0] ?? 4) !== score.time[0] || (time?.[1] ?? 4) !== score.time[1]) {
            unsupported.add("staves in different keys or metres");
          }
        }
        if (k === "Rest" && ev.full) {
          out.events.push(...rests(score, lengthOf(out), ev.ticks * Math.max(1, ev.count)));
          continue;
        }
        let tuplet = null;
        if (ev.tuplet) {
          const [tid, n, d] = ev.tuplet;
          if (!tuplets.has(tid)) tuplets.set(tid, newId());
          tuplet = { id: tuplets.get(tid), n, d };
        }
        const texts = ev.texts.map(([text, dir]) => ({ text, dir }));
        // A short word above a note that reads as a chord is its chord symbol.
        const chordAt = texts.findIndex((w) => w.dir < 0 && /^[A-G][#b♯♭]?(m|maj|min|dim|aug|sus|add|°|ø|\+)?[0-9]*(\/[A-G][#b♯♭]?)?$/.test(w.text));
        const chord = chordAt >= 0 ? texts.splice(chordAt, 1)[0].text : ev.chord_name || "";
        const arts = ev.scripts.map(([name]) => name).filter((n) => SCRIPTS[n]);
        if (ev.scripts.some(([name]) => !SCRIPTS[name])) unsupported.add("some articulations");
        out.events.push(makeEvent({
          rest: k === "Rest", pitches: ev.pitches.map(([d, alter]) => ({ d, alter })), base: ev.base, dots: ev.dots, tuplet,
          tie: ev.tie, slurStart: ev.slur_on, slurEnd: ev.slur_off, dynamic: ev.dynamic ?? null,
          hairpin: ev.hairpin ?? null, hairpinEnd: ev.hairpin_end, arts, chord, texts,
        }));
      }
    }
    if (staff.lyrics) {
      if (staff.lyrics_voice !== 1) unsupported.add("lyrics to a second voice");
      let k = 0;
      const skip = melismata(out);
      out.events.forEach((ev, i) => {
        if (skip[i]) return;
        const syl = staff.lyrics[k++];
        if (syl && syl.text && syl.text !== "_") ev.lyric = { text: syl.text, hyphen: syl.hyphen, extend: syl.extend };
      });
    }
    score.staves.push(out);
    first = false;
  }
  if (signs.length) {
    const repeats = repeatsFrom(signs);
    if (repeats) score.repeats = repeats;
    else unsupported.add("repeats this editor cannot follow");
  }
  if (unsupported.size) return { unsupported: [...unsupported] };
  if (!score.staves.length) return { unsupported: ["a piece with no staff"] };
  const bar = barLength(score);
  ensureLength(score, Math.max(...score.staves.map(lengthOf), bar));
  if (score.staves.some((st) => lengthOf(st) % bar !== 0)) return { unsupported: ["a bar left unfinished"] };
  return { score };
}
