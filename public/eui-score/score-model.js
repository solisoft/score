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
    if (!(k === 0 && keepsStart)) Object.assign(p, { slurStart: false, dynamic: null, hairpin: null, arts: [], chord: "", texts: [], lyric: null });
    if (!(last && keepsEnd)) Object.assign(p, { slurEnd: false, hairpinEnd: false });
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
    const plain = ev.rest && !ev.tuplet && !ev.dynamic && !ev.hairpin && !ev.hairpinEnd && !ev.texts.length && !ev.chord && !ev.arts.length;
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

/** The pitch of the last note before event `i`, for a letter to land near. */
export function previousPitch(score, s, i) {
  const events = score.staves[s].events;
  for (let k = i - 1; k >= 0; k--) if (!events[k].rest) return events[k].pitches[0].d;
  const clef = score.staves[upperOf(score, s)].clef;
  return clef.startsWith("bass") ? 3 : clef === "alto" ? 7 : clef === "tenor" ? 5 : 13;
}

/** Event `i` moved by step, semitone or octave — one head `head` of a chord, or all. */
export function move(score, s, i, how, by, head = -1) {
  const ev = noteOf(score, s, i);
  if (ev.rest) throw new Error("select a note");
  const moved = ev.pitches.map((p, k) => (head < 0 || k === head ? movePitch(p, how, by, keyOf(score, s, starts(score.staves[s])[i])) : p));
  if (!moved.every(reachable)) throw new Error("that is as far as it goes");
  ev.pitches = sortPitches(moved);
}

/** Event `i` given step `step` (C = 0 … B = 6) near where it was; a rest becomes that note. `add` adds it above a chord. */
export function letter(score, s, i, step, add = false, head = -1) {
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
    if (!ev.pitches.some((q) => q.d === p.d)) ev.pitches = sortPitches([...ev.pitches, p]);
    return;
  }
  const k = head >= 0 && head < ev.pitches.length ? head : 0;
  const p = nearestPitch(step, ev.pitches[k].d, keyOf(score, s, starts(score.staves[s])[i]));
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
  if (isLower(score, s)) throw new Error("words go with the first voice");
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
  return events.some((ev) => !ev.rest || ev.dynamic || ev.hairpin || ev.hairpinEnd || ev.texts.length || ev.chord || ev.arts.length);
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
      if (ev.rest && !ev.dynamic && !ev.texts.length && !ev.chord && !ev.hairpin && !ev.hairpinEnd) continue;
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
 * its lane and event. `open` lists bars of second voices to write even when
 * they hold only rests — where the page is writing in them — as
 * `[{ staff: lane, bar }]`.
 */
export function toLilyPond(score, { open = [] } = {}) {
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
      return changesText(score, s, b) + (shown ? `<< { ${bar.text} } \\\\ { ${other.text} } >>` : bar.text);
    });
    const music = withRepeats(bars, repeats);
    const lastRepeat = repeats.find((r) => r.endings.length === 0 && r.to === bars.length - 1);
    const name = staff.name ? `instrumentName = ${quote(staff.name)} ` : "";
    const short = staff.short ? `shortInstrumentName = ${quote(staff.short)} ` : "";
    const midi = staff.instrument ? `midiInstrument = ${quote(staff.instrument)} ` : "";
    const tempo = s === 0 && score.tempo && (score.tempo.text || score.tempo.bpm) ? ` ${tempoText(score.tempo)}` : "";
    const clef = clefText(staff.clef);
    const time = staff.time ?? score.time;
    const settings = name + short + midi;
    // A piece that ends on a repeat's end keeps its :|. sign, not a final bar.
    const ending = lastRepeat ? "" : ' \\bar "|."';
    let out = `\\new Staff ${settings ? `\\with { ${settings}} ` : ""}{\n  \\clef ${clef} \\key ${KEYS[keyOf(score, s)]} \\major \\time ${time[0]}/${time[1]}${tempo}\n  ${music.replace(/\n {4}/g, "\n  ")}${ending}\n}`;
    const lyrics = lyricText(staff);
    if (lyrics) out += `\n\\addlyrics { ${lyrics} }`;
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
  return { source: (header ? `\\header { ${header} }\n` : "") + body + "\n", items };
}

const clefText = (clef) => (CLEFS.includes(clef) ? (clef.includes("_") ? `"${clef}"` : clef) : "treble");
const tempoText = (tempo) => `\\tempo ${tempo.text ? quote(tempo.text) + " " : ""}${tempo.bpm ? `${tempo.base} = ${tempo.bpm}` : ""}`.trimEnd();

/** What staff `s` writes at the start of bar `b` for what changes there. */
function changesText(score, s, b) {
  if (b === 0) return "";
  const parts = [];
  const clef = (score.staves[s].clefs ?? []).find((c) => c.bar === b);
  if (clef) parts.push(`\\clef ${clefText(clef.clef)}`);
  const c = changeAt(score, b);
  if (c?.key != null) parts.push(`\\key ${KEYS[keyOf(score, s, barStart(score, b))]} \\major`);
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
    if (staff.kind !== "Notes") unsupported.add(staff.kind === "Tab" ? "tablature" : staff.kind === "Drums" ? "drum staves" : "chord-name staves");
    const out = { name: staff.name ?? "", short: staff.short ?? "", instrument: staff.instrument ?? "", clef: "treble", events: [] };
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
      const k = ev.k;
      // A change after the first note is the bar's it starts: the first staff
      // writes the score's changes, the others must change with it.
      const here = lengthOf(lane);
      const bar = isBarLine(score, here) ? barAt(score, here) : -1;
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
        if (!started) time = ev.time;
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
            if ((key ?? 0) !== score.key) out.key = key ?? 0;
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
        const texts = ev.texts.map(([text, dir]) => ({ text, dir }));
        // A short word above a note that reads as a chord is its chord symbol.
        const chordAt = texts.findIndex((w) => w.dir < 0 && /^[A-G][#b♯♭]?(m|maj|min|dim|aug|sus|add|°|ø|\+)?[0-9]*(\/[A-G][#b♯♭]?)?$/.test(w.text));
        const chord = chordAt >= 0 ? texts.splice(chordAt, 1)[0].text : ev.chord_name || "";
        const arts = ev.scripts.map(([name]) => name).filter((n) => SCRIPTS[n]);
        if (ev.scripts.some(([name]) => !SCRIPTS[name])) unsupported.add("some articulations");
        lane.events.push(makeEvent({
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
