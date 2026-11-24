// The score editor's tools on many notes at once (#1024): a selection over
// several staves, staves moved, transposing to a key, durations doubled and
// halved, retrograde and inversion, paste special, explode and implode.
//
// Each works on the model (score-model.js) as its edits do, and is one edit
// of the editor (studio-commands.js): one Undo takes it back. A selection is
// handed over as `ranges`, [{ s, a, b }]: lane `s`'s events `a`…`b`.

// Served immutable: this module's version goes to the ones it loads.
const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);
const { tr } = await import(`./words.js${V}`);

// ---- A selection over several staves ------------------------------------------------

/** The lanes of the staves from lane `a`'s to lane `b`'s, every voice of each, top to bottom. */
export function lanesBetween(score, a, b) {
  const [top, bottom] = [Math.min(a, b), Math.max(a, b)];
  const first = M.upperOf(score, top);
  const last = M.voiceLanes(score, bottom).at(-1);
  return score.staves.map((_, s) => s).filter((s) => s >= first && s <= last);
}

/** Each lane of `lanes`'s events that start in bars `a`…`b`: [{ s, a, b }], the lanes with none left out. */
export function barRanges(score, lanes, a, b) {
  const t0 = M.barStart(score, Math.min(a, b));
  const t1 = M.barStart(score, Math.max(a, b) + 1);
  const out = [];
  for (const s of lanes) {
    const staff = score.staves[s];
    if (!staff) continue;
    const inside = M.starts(staff).map((t, i) => (t >= t0 && t < t1 ? i : -1)).filter((i) => i >= 0);
    if (inside.length) out.push({ s, a: inside[0], b: inside.at(-1) });
  }
  return out;
}

/**
 * Each lane of `lanes`'s events that start from `t0` to `t1` (ticks, both
 * kept): [{ s, a, b }], the lanes with none left out — a selection over
 * several staves that begins or ends in the middle of a bar (#1038).
 */
export function spanRanges(score, lanes, t0, t1) {
  const [from, to] = [Math.min(t0, t1), Math.max(t0, t1)];
  const out = [];
  for (const s of lanes) {
    const staff = score.staves[s];
    if (!staff) continue;
    const inside = M.starts(staff).map((t, i) => (t >= from && t <= to ? i : -1)).filter((i) => i >= 0);
    if (inside.length) out.push({ s, a: inside[0], b: inside.at(-1) });
  }
  return out;
}

/**
 * What a rectangle drawn over the score takes (#1038): the events whose head
 * — a rest's glyph, a note without heads its box — has its middle inside
 * `rect` ([x0, y0, x1, y1], the drawing's coordinates, any two corners).
 * `drawn` is the drawing's items ({ item, box, heads: [{ box }] }), `items`
 * what each item is ({ staff, index }). Answers { lanes, t0, t1 } — the lanes
 * top to bottom, the first and the last event's start — or null for none.
 */
export function caughtIn(score, rect, drawn, items) {
  const [x0, x1] = [Math.min(rect[0], rect[2]), Math.max(rect[0], rect[2])];
  const [y0, y1] = [Math.min(rect[1], rect[3]), Math.max(rect[1], rect[3])];
  const inside = (box) => {
    const [x, y] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const lanes = new Set();
  let [t0, t1] = [Infinity, -Infinity];
  for (const it of drawn ?? []) {
    const at = items[it.item];
    const staff = at && score.staves[at.staff];
    if (!staff?.events[at.index]) continue;
    const boxes = it.heads?.length ? it.heads.map((h) => h.box) : [it.box];
    if (!boxes.some(inside)) continue;
    const t = M.starts(staff)[at.index];
    lanes.add(at.staff);
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
  }
  return lanes.size ? { lanes: [...lanes].sort((a, b) => a - b), t0, t1 } : null;
}

/**
 * The bars `lanes`' events from `t0` to `t1` (their starts) fill, whole —
 * every event of each lane in them, none more — as [a, b]; null when the
 * span begins or ends inside a bar (#1038).
 */
export function wholeBars(score, lanes, t0, t1) {
  const [from, to] = [Math.min(t0, t1), Math.max(t0, t1)];
  const a = M.barAt(score, from);
  const b = M.barAt(score, to);
  const [start, end] = [M.barStart(score, a), M.barStart(score, b + 1)];
  if (from !== start) return null;
  for (const s of lanes) {
    const staff = score.staves[s];
    if (!staff) return null;
    if (M.starts(staff).some((t) => t >= start && t < end && (t < from || t > to))) return null;
  }
  return [a, b];
}

/** The ranges whose lanes hold pitched notes:not a drum staff, a line of chord names or a figured bass. */
function pitchedRanges(score, ranges) {
  return ranges.filter((r) => !M.isDrums(score, r.s) && !M.isChords(score, r.s) && !M.isFigures(score, r.s));
}

/** The start times of the notes (not the rests) of a range. */
function noteTimes(score, r) {
  const staff = score.staves[r.s];
  const at = M.starts(staff);
  const out = [];
  for (let i = r.a; i <= r.b; i++) if (!staff.events[i].rest) out.push(at[i]);
  return out;
}

const NO_NOTE = () => tr("There is no note in the selection to change");

/** Every note of the ranges made a rest (Delete). */
export function clearRanges(score, ranges) {
  for (const r of ranges) {
    // By time, from the last: a rest made merges with the rests beside it.
    for (const t of noteTimes(score, r).reverse()) {
      const i = M.eventAt(score.staves[r.s], t);
      if (i >= 0) M.remove(score, r.s, i);
    }
  }
}

/** The ranges' notes transposed by `steps` letters and `semitones`; drum staves passed over, refused when all are. */
export function transposeRanges(score, ranges, { steps, semitones }) {
  const pitched = pitchedRanges(score, ranges);
  if (!pitched.length) throw new Error(tr("Drums and chord names are not transposed: select notes of another staff"));
  for (const r of pitched) M.transpose(score, { steps, semitones, s: r.s, a: r.a, b: r.b });
}

/** The ranges' notes moved (`how`: "step", "semitone" or "octave"), a note tied from the one before moving with it. */
export function moveRanges(score, ranges, how, by) {
  const pitched = pitchedRanges(score, ranges);
  if (!pitched.some((r) => noteTimes(score, r).length)) throw new Error(NO_NOTE());
  for (const r of pitched) {
    const events = score.staves[r.s].events;
    for (let i = r.a; i <= r.b; i++) {
      if (!events[i].rest && !(i > r.a && events[i - 1].tie && !events[i - 1].rest)) M.move(score, r.s, i, how, by);
    }
  }
}

/** Articulation `name` on every note of the ranges (a fermata on rests too); again takes it away. */
export function toggleArticulationRanges(score, ranges, name) {
  const marked = pitchedRanges(score, ranges).concat(ranges.filter((r) => M.isDrums(score, r.s)));
  const fits = (ev) => !ev.rest || M.FERMATAS.includes(name);
  if (!marked.some((r) => score.staves[r.s].events.slice(r.a, r.b + 1).some(fits))) throw new Error(NO_NOTE());
  for (const r of marked) {
    for (let i = r.a; i <= r.b; i++) if (fits(score.staves[r.s].events[i])) M.toggleArticulation(score, r.s, i, name);
  }
}

/** Dynamic `name` on the first note of each range's staff; refused when there is no note. */
export function dynamicOnRanges(score, ranges, name) {
  let put = 0;
  for (const r of pitchedRanges(score, ranges).concat(ranges.filter((x) => M.isDrums(score, x.s)))) {
    const events = score.staves[r.s].events;
    for (let i = r.a; i <= r.b; i++) {
      if (events[i].rest) continue;
      M.setDynamic(score, r.s, i, name);
      put++;
      break;
    }
  }
  if (!put) throw new Error(NO_NOTE());
}

// ---- Staves moved ------------------------------------------------------------------
//
// A staff moves with what belongs to it: its voices (the lanes after it), the
// line of chord names over it, the figured bass under it; a piano's braced
// staves move as one. Those are the "units" the staves move by.

/** The staves as they move: [[staff numbers]], top to bottom. */
export function staffUnits(score) {
  const tops = M.staffLanes(score);
  const units = [];
  tops.forEach((u, n) => {
    const overChords = n > 0 && score.staves[tops[n - 1]].chords;
    const braced = (score.groups ?? []).some((g) => g.kind === "brace" && n > g.first && n <= g.last);
    if (units.length && (overChords || score.staves[u].figures || braced)) units.at(-1).push(n);
    else units.push([n]);
  });
  return units;
}

/** The unit lane `s` is in: its index in staffUnits. */
export function unitOf(score, s) {
  const n = M.staffNumber(score, s);
  return staffUnits(score).findIndex((unit) => unit.includes(n));
}

/** What the settings line keeps by lane (META_KEYS' `lanes`) moved by `moved`, each old lane's new one. */
function permuteMetaLanes(meta, moved) {
  if (!meta) return;
  for (const [, lanes] of M.metaLaneKeys()) {
    const map = lanes.of(meta);
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    // An audio track's ("audio-1") is no staff's lane: it stays as it is.
    const key = (k) => {
      const lane = String(lanes.lane(k));
      return /^\d+$/.test(lane) && moved[Number(lane)] != null ? lanes.rekey(k, moved[Number(lane)]) : k;
    };
    lanes.put(meta, Object.fromEntries(Object.entries(map).map(([k, value]) => [key(k), value])));
  }
}

const contiguous = (list) => list.length > 0 && Math.max(...list) - Math.min(...list) + 1 === list.length;

/**
 * Unit `from` (see staffUnits) moved to unit place `to`, the others closing
 * up: its lanes, what the settings line keeps by them, and the groups — a
 * group keeps its staves; a staff moved out across its edge leaves it, one
 * moved into its middle joins it. Answers each old lane's new lane.
 */
export function moveStaff(score, from, to) {
  const units = staffUnits(score);
  if (units.length < 2) throw new Error(tr("This score has one staff: there is nowhere to move it"));
  if (!units[from]) throw new Error(tr("no such staff"));
  if (to < 0) throw new Error(tr("This staff is the first already"));
  if (to >= units.length) throw new Error(tr("This staff is the last already"));
  const order = units.map((_, k) => k);
  order.splice(to, 0, ...order.splice(from, 1));
  const tops = M.staffLanes(score);
  const staffOrder = order.flatMap((k) => units[k]);
  const laneOrder = staffOrder.flatMap((n) => M.voiceLanes(score, tops[n]));
  const moved = [];
  laneOrder.forEach((old, lane) => (moved[old] = lane));
  const staffMoved = [];
  staffOrder.forEach((old, n) => (staffMoved[old] = n));
  score.staves = laneOrder.map((old) => score.staves[old]);
  permuteMetaLanes(score.meta, moved);
  const mover = new Set(units[from].map((n) => staffMoved[n]));
  score.groups = (score.groups ?? []).map((g) => {
    const members = [];
    for (let n = g.first; n <= g.last; n++) members.push(staffMoved[n]);
    const without = members.filter((n) => !mover.has(n));
    const kept = contiguous(members) ? members : contiguous(without) ? without : members;
    return { ...g, first: Math.min(...kept), last: Math.max(...kept) };
  });
  return moved;
}

// ---- Transposing to a key, and in the key ------------------------------------------------

const mod7 = (n) => ((n % 7) + 7) % 7;
const mod12 = (n) => ((n % 12) + 12) % 12;
/** A major or perfect interval's semitones, by its letters (0 a unison … 6 a seventh). */
const SIZES = [0, 2, 4, 5, 7, 9, 11];

/**
 * The interval from key `from` to key `to` (fifths; the mode is the same
 * either side): `way` 1 up, −1 down, 0 the nearest way (up when as near).
 * Answers `{ steps, semitones }` as M.transpose takes it.
 */
export function keyInterval(from, to, way = 0) {
  const steps = mod7(4 * (to - from));
  // The semitones with the letters: an augmented seventh is 12, a diminished unison −1.
  const tones = mod12(7 * (to - from));
  const semitones = [tones - 12, tones, tones + 12].reduce((best, x) => (Math.abs(x - SIZES[steps]) < Math.abs(best - SIZES[steps]) ? x : best));
  if (steps === 0 && semitones === 0) return way > 0 ? { steps: 7, semitones: 12 } : way < 0 ? { steps: -7, semitones: -12 } : { steps: 0, semitones: 0 };
  // A diminished unison (C to C♭) goes down; up, it is a diminished octave.
  const up = semitones > 0 || (semitones === 0 && steps > 0) ? { steps, semitones } : { steps: steps + 7, semitones: semitones + 12 };
  const down = { steps: up.steps - 7, semitones: up.semitones - 12 };
  if (way > 0) return up;
  if (way < 0) return down;
  return Math.abs(down.semitones) < Math.abs(up.semitones) ? down : up;
}

const clampKey = (k) => Math.max(-7, Math.min(7, k));

/** Every key signature of the score moved `by` fifths, as M.transpose moves them. */
function shiftKeys(score, by) {
  score.key = clampKey(score.key + by);
  for (const staff of score.staves) {
    if (staff.key != null) staff.key = clampKey(staff.key + by);
    for (const m of staff.keys ?? []) m.key = clampKey(m.key + by);
  }
  for (const c of score.changes ?? []) if (c.key != null) c.key = clampKey(c.key + by);
  for (const m of score.midKeys ?? []) m.key = clampKey(m.key + by);
}

/** The time the first of `ranges` starts at. */
function rangesStart(score, ranges) {
  const r = ranges[0];
  return M.starts(score.staves[r.s])[r.a];
}

/**
 * To key `to` (fifths −7…7): the whole score, its key signatures and chord
 * symbols with it, or with `ranges` the notes of a selection alone, from the
 * key they are in. `way`: 1 up, −1 down, 0 the nearest; `octave`: an octave
 * more up (1) or down (−1).
 */
export function transposeToKey(score, to, { way = 0, octave = 0, ranges = null } = {}) {
  if (!Number.isInteger(to) || Math.abs(to) > 7) throw new Error(tr("no such key"));
  const from = ranges ? M.keyOf(score, ranges[0].s, rangesStart(score, ranges)) : score.key;
  const by = keyInterval(from, to, way);
  by.steps += 7 * octave;
  by.semitones += 12 * octave;
  if (ranges) return transposeRanges(score, ranges, by);
  M.transpose(score, by);
  // A key seven fifths or more away is past M.transpose's nearest way round: put right.
  if (score.key !== to) shiftKeys(score, to - score.key);
}

/** Pitch `p` moved `degrees` letters in key `fifths`: an alteration the key does not give kept apart from it. */
function degreePitch(p, degrees, fifths) {
  const alters = M.keyAlters(fifths);
  const d = p.d + degrees;
  const own = p.alter - alters[mod7(p.d)];
  return { d, alter: Math.max(-2, Math.min(2, alters[mod7(d)] + own)) };
}

/** A chord symbol's root (and its bass) moved `degrees` letters in key `fifths`. */
function degreeChord(text, degrees, fifths, chordmode = false) {
  const found = chordmode ? /^([a-g])((?:is|es|s)*)/.exec(text) : /^([A-G])([#♯b♭]?)/.exec(text);
  if (!found) return text;
  const alter = chordmode ? { is: 1, isis: 2, es: -1, s: -1, eses: -2, ses: -2 }[found[2]] ?? 0 : { "#": 1, "♯": 1, b: -1, "♭": -1 }[found[2]] ?? 0;
  const root = { d: 7 + "cdefgab".indexOf(found[1].toLowerCase()), alter };
  const moved = degreePitch(root, degrees, fifths);
  const semitones = M.midiKey(moved.d, moved.alter) - M.midiKey(root.d, root.alter);
  return chordmode ? M.transposeChordmode(text, degrees, semitones) : M.transposeChord(text, degrees, semitones);
}

/**
 * Every note moved `degrees` letters (negative: down) in the key it is in —
 * the whole score, its chord symbols with it, or with `ranges` a selection
 * alone. The key signatures stay.
 */
export function transposeDiatonic(score, degrees, { ranges = null } = {}) {
  if (!Number.isInteger(degrees) || degrees === 0) throw new Error(tr("Choose how many degrees to move the notes by"));
  const all = !ranges;
  const chosen = ranges ?? score.staves.map((staff, s) => ({ s, a: 0, b: staff.events.length - 1 }));
  const pitched = pitchedRanges(score, chosen);
  if (!all && !pitched.length) throw new Error(tr("Drums and chord names are not transposed: select notes of another staff"));
  for (const r of pitched) {
    const staff = score.staves[r.s];
    const at = M.starts(staff);
    for (let i = r.a; i <= r.b; i++) {
      const ev = staff.events[i];
      const fifths = M.keyOf(score, r.s, at[i]);
      if (!ev.rest) {
        const moved = ev.pitches.map((p) => degreePitch(p, degrees, fifths));
        M.followHeads(ev, ev.pitches, moved);
        ev.pitches = moved;
      }
      for (const g of [...ev.graces, ...(ev.afterGraces ?? [])]) M.moveGraceTo(g, g.pitches.map((p) => degreePitch(p, degrees, fifths)));
      if (all && ev.chord && ev.chord !== "N.C.") ev.chord = degreeChord(ev.chord, degrees, fifths);
    }
  }
  if (!all) return;
  // The lines of chord names, and the ossias, with the score.
  score.staves.forEach((staff, s) => {
    if (!M.isChords(score, s)) return;
    const at = M.starts(staff);
    staff.events.forEach((ev, i) => {
      if (ev.chordmode && ev.chordmode !== "r") ev.chordmode = degreeChord(ev.chordmode, degrees, M.keyOf(score, s, at[i]), true);
    });
  });
  for (const staff of score.staves) {
    for (const o of staff.ossias ?? []) for (const ev of o.events) if (!ev.rest) ev.pitches = ev.pitches.map((p) => degreePitch(p, degrees, score.key));
  }
}

// ---- Durations doubled or halved -----------------------------------------------------

/** The shortest value written: a 128th. */
const SHORTEST = M.WHOLE / 128;

/** Whether lane `s` holds a tuplet event in ticks [t0, t1). */
function tupletIn(score, s, t0, t1) {
  const staff = score.staves[s];
  const at = M.starts(staff);
  return staff.events.some((ev, i) => ev.tuplet && at[i] < t1 && at[i] + M.ticksOf(ev) > t0);
}

/**
 * Every event of the ranges `factor` (2 or ½) as long, from where the first
 * starts: halved, rests after them to where they ended; doubled, written
 * over what follows, tied across bar lines, the score longer if it must
 * be. Refused, before anything changes, when a note would be shorter than
 * a 128th or a tuplet is in the selection or in the way.
 */
export function scaleDurations(score, ranges, factor) {
  if (factor !== 2 && factor !== 0.5) throw new Error(tr("Durations double or halve: nothing else"));
  const plans = ranges.map((r) => {
    const staff = score.staves[r.s];
    const at = M.starts(staff);
    const t0 = at[r.a];
    const t1 = at[r.b] + M.ticksOf(staff.events[r.b]);
    const length = t1 - t0;
    if (tupletIn(score, r.s, t0, t1)) throw new Error(tr("A tuplet is in the selection: durations are doubled or halved outside triplets and the like"));
    if (factor > 1 && tupletIn(score, r.s, t1, t0 + 2 * length)) throw new Error(tr("Doubled, the notes would write over a tuplet: select fewer, or take the tuplet away first"));
    const clip = M.copy(score, r.s, r.a, r.b).map((piece) => ({ ...piece, ticks: piece.ticks * factor }));
    if (clip.some((piece) => !Number.isInteger(piece.ticks) || piece.ticks < SHORTEST || !M.spellDuration(piece.ticks).length)) {
      throw new Error(tr("Halved, a note would be shorter than a 128th: leave the shortest notes out"));
    }
    return { s: r.s, t0, length, clip };
  });
  for (const { s, t0, length, clip } of plans) {
    M.paste(score, s, t0, clip);
    if (factor < 1) M.write(score, s, t0 + length / 2, length / 2, { rest: true });
  }
}

// ---- Retrograde and inversion ------------------------------------------------------------

const TUPLET_REFUSED = () => tr("A tuplet is in the selection: leave triplets and the like out of it");

/** The ranges with a tuplet among their events refused. */
function refuseTuplets(score, ranges) {
  for (const r of ranges) if (score.staves[r.s].events.slice(r.a, r.b + 1).some((ev) => ev.tuplet)) throw new Error(TUPLET_REFUSED());
}

/**
 * A clipboard (M.copy) backwards: each piece with its length and marks; the
 * ties, slurs, phrasing slurs, beams and hairpins turned round; the
 * syllables left in their order on the notes.
 */
function backwards(clip) {
  const n = clip.length;
  const was = clip.map((piece) => piece.content);
  // Hairpins paired, start to end: the end becomes the start, the other way round.
  const opens = new Map();
  const closes = new Map();
  let open = -1;
  was.forEach((c, k) => {
    if (c.hairpinEnd && open >= 0) {
      opens.set(k, was[open].hairpin === "<" ? ">" : "<");
      closes.set(open, true);
      open = -1;
    }
    if (c.hairpin) open = k;
  });
  const sung = was.filter((c) => !c.rest).map((c) => ({ lyric: c.lyric ?? null, verses: c.verses ?? [] }));
  const out = [];
  for (let m = 0; m < n; m++) {
    const k = n - 1 - m;
    const c = structuredClone(was[k]);
    c.tie = !c.rest && m < n - 1 && Boolean(was[k - 1]?.tie) && !was[k - 1].rest;
    [c.slurStart, c.slurEnd] = [Boolean(was[k].slurEnd), Boolean(was[k].slurStart)];
    [c.beamStart, c.beamEnd] = [was[k].beamEnd, was[k].beamStart];
    if (!c.beamStart) delete c.beamStart;
    if (!c.beamEnd) delete c.beamEnd;
    const phrase = [was[k].phraseEnd, was[k].phraseStart];
    delete c.phraseStart;
    delete c.phraseEnd;
    if (phrase[0]) c.phraseStart = true;
    if (phrase[1]) c.phraseEnd = true;
    // Which way a slur bends is found again, from its new first note.
    delete c.slurDir;
    delete c.phraseDir;
    delete c.hairpinWords;
    c.hairpin = opens.get(k) ?? null;
    c.hairpinEnd = closes.has(k);
    out.push({ content: c, ticks: clip[k].ticks });
  }
  let next = 0;
  for (const piece of out) {
    if (piece.content.rest) continue;
    Object.assign(piece.content, sung[next++]);
  }
  return out;
}

/** Each range's notes and rests backwards (see backwards); refused on a tuplet. */
export function retrograde(score, ranges) {
  refuseTuplets(score, ranges);
  for (const r of ranges) {
    const t0 = M.starts(score.staves[r.s])[r.a];
    M.paste(score, r.s, t0, backwards(M.copy(score, r.s, r.a, r.b)));
  }
}

/** Whether a pitch can be written and played: within the staff's reach and a piano's keys. */
const playable = (p) => p.d >= -7 && p.d <= 42 && M.midiKey(p.d, p.alter) >= 21 && M.midiKey(p.d, p.alter) <= 108;

/**
 * Pitch `p` mirrored around `axis` by the key's letters (`fifths`): the
 * key's notes stay in the key; a note the key does not hold flips its sharp
 * or flat, unless it has the axis's letter, whose sign it keeps.
 */
function mirrored(p, axis, fifths) {
  const alters = M.keyAlters(fifths);
  const d = 2 * axis.d - p.d;
  const own = p.alter - alters[mod7(p.d)];
  const alter = alters[mod7(d)] + (mod7(p.d) === mod7(axis.d) ? own : -own);
  return { d, alter: Math.max(-2, Math.min(2, alter)) };
}

/**
 * Each range's notes inverted around its first note (the lowest of a
 * chord), diatonically, in the key each note is in. Refused when there is
 * no note, or a note would go past what can be written, before anything
 * changes.
 */
export function invert(score, ranges) {
  const pitched = pitchedRanges(score, ranges);
  const changes = [];
  for (const r of pitched) {
    const staff = score.staves[r.s];
    const at = M.starts(staff);
    const first = staff.events.slice(r.a, r.b + 1).find((ev) => !ev.rest);
    if (!first) continue;
    const axis = first.pitches[0];
    for (let i = r.a; i <= r.b; i++) {
      const ev = staff.events[i];
      const fifths = M.keyOf(score, r.s, at[i]);
      const turn = (pitches) => pitches.map((p) => mirrored(p, axis, fifths));
      const pitches = ev.rest ? null : turn(ev.pitches);
      const graces = [...ev.graces, ...(ev.afterGraces ?? [])].map((g) => [g, turn(g.pitches)]);
      if ([pitches ?? [], ...graces.map(([, now]) => now)].flat().some((p) => !playable(p))) {
        throw new Error(tr("Inverted, a note would go too far from the first to be written: select fewer, or lower ones"));
      }
      changes.push({ ev, pitches, graces });
    }
  }
  if (!changes.some((c) => c.pitches)) throw new Error(NO_NOTE());
  const sorted = (pitches) => [...pitches].sort((x, y) => x.d - y.d || x.alter - y.alter);
  for (const { ev, pitches, graces } of changes) {
    if (pitches) {
      M.followHeads(ev, ev.pitches, pitches);
      ev.pitches = sorted(pitches);
    }
    for (const [g, now] of graces) {
      M.moveGraceTo(g, now);
      g.pitches = sorted(g.pitches);
    }
  }
}

// ---- Paste special -------------------------------------------------------------------------

/** The kinds of paste special: the notes without their marks, the rhythm on the pitches there, the marks alone. */
export const PASTE_FILTERS = ["notes", "rhythm", "marks"];

/** A copied event's content with its marks taken off: what "the notes only" pastes. */
function unmarked(content) {
  const out = { ...structuredClone(content), dynamic: null, hairpin: null, hairpinEnd: false, arts: [], lyric: null, verses: [], texts: [], chord: "", slurStart: false, slurEnd: false, pedalOn: false, pedalOff: false };
  for (const field of ["hairpinWords", "artDirs", "slurDir", "phraseStart", "phraseEnd", "phraseDir", "fingers", "breath", "spanStart", "spanEnd", "tweaks", "fret", "fretBelow", "sostOn", "sostOff", "cordaOn", "cordaOff"]) delete out[field];
  return out;
}

/** The pitches of lane `s`'s notes from `t` on, a tied note once: [[pitch]]. */
function pitchesFrom(score, s, t) {
  const staff = score.staves[s];
  const at = M.starts(staff);
  const out = [];
  staff.events.forEach((ev, i) => {
    const tiedFrom = i > 0 && staff.events[i - 1].tie && !staff.events[i - 1].rest;
    if (at[i] >= t && !ev.rest && !tiedFrom) out.push(ev.pitches);
  });
  return out;
}

const NO_PITCHES = () => tr("There is no note there to keep the pitches of: paste the rhythm over notes");
const NO_MARKS = () => tr("There is no note there starting where the copied marks do");

/** The copied rhythm with lane `s`'s pitches from `t` on, a tied note one pitch, the last kept when they run out. */
function onPitches(score, s, t, clip) {
  const pitches = pitchesFrom(score, s, t);
  if (!pitches.length && clip.some((piece) => !piece.content.rest)) throw new Error(NO_PITCHES());
  let next = -1;
  let tied = false;
  return clip.map((piece) => {
    const content = { ...unmarked(piece.content), graces: [], grace: null, arpeggio: false, gliss: false };
    delete content.afterGraces;
    delete content.afterAt;
    delete content.forced;
    delete content.cautionary;
    delete content.harmonics;
    if (!content.rest) {
      if (!tied) next = Math.min(next + 1, pitches.length - 1);
      content.pitches = pitches[next].map((p) => ({ ...p }));
    }
    tied = !content.rest && Boolean(content.tie);
    return { ...piece, content };
  });
}

/** The copied marks put on lane `s`'s events that start where the copied ones did, from `t`: how many took one. */
function putMarks(score, s, t, clip) {
  const staff = score.staves[s];
  let put = 0;
  let at = t;
  for (const piece of clip) {
    const c = piece.content;
    const i = M.eventAt(staff, at);
    at += piece.ticks;
    const ev = staff.events[i];
    if (!ev) continue;
    let took = false;
    const take = (fields) => {
      Object.assign(ev, fields);
      took = true;
    };
    if (c.dynamic) take({ dynamic: c.dynamic });
    if (c.hairpin || c.hairpinEnd) take({ hairpin: c.hairpin ?? ev.hairpin, hairpinEnd: Boolean(c.hairpinEnd || ev.hairpinEnd) });
    const arts = (c.arts ?? []).filter((name) => !ev.rest || name === "fermata");
    if (arts.length) take({ arts: [...new Set([...ev.arts, ...arts])] });
    if (!ev.rest) {
      if (c.slurStart) take({ slurStart: true });
      if (c.slurEnd) take({ slurEnd: true });
      if (c.lyric) take({ lyric: structuredClone(c.lyric) });
      if (c.verses?.length) take({ verses: structuredClone(c.verses) });
    }
    if (took) put++;
  }
  return put;
}

/** One lane's clipboard pasted as `filter` says, from `t`; answers how many events took marks (for "marks"). */
function pasteLane(score, s, t, clip, filter) {
  if (filter === "marks") return putMarks(score, s, t, clip);
  M.paste(score, s, t, filter === "rhythm" ? onPitches(score, s, t, clip) : clip.map((piece) => ({ ...piece, content: unmarked(piece.content) })));
  return 1;
}

/**
 * What was copied (`clip`: M.copy's, or `{ section }` from M.copySection)
 * pasted at lane `s`, time `t`, in part (`filter`, see PASTE_FILTERS). A
 * section goes from the bar `t` is in, each part on its staff and voice as
 * a plain paste puts it; a part with no staff or voice there is left out.
 * Refused when the rhythm finds no pitch, or the marks no note.
 */
export function pasteSpecial(score, s, t, clip, filter) {
  if (!PASTE_FILTERS.includes(filter)) throw new Error(tr("Paste the notes, the rhythm or the marks"));
  if (!clip.section) {
    if (!pasteLane(score, s, t, clip, filter)) throw new Error(NO_MARKS());
    return 0;
  }
  const { section } = clip;
  // Bars go from the bar's start; notes of several staves (#1038) from `t`, each part as far after it as it was.
  const from = section.span ? t : M.barStart(score, M.barAt(score, t));
  let skipped = 0;
  let took = 0;
  for (const part of section.parts) {
    const staff = section.parts.length === 1 ? M.upperOf(score, s) : M.staffLanes(score)[M.staffNumber(score, s) + part.offset];
    const lane = section.parts.length === 1 ? s : staff == null ? -1 : M.laneOfVoice(score, staff, part.voice ?? 1);
    if (lane < 0) {
      skipped++;
      continue;
    }
    took += pasteLane(score, lane, from + (part.at ?? 0), part.pieces, filter);
  }
  if (!took) throw new Error(filter === "marks" ? NO_MARKS() : tr("There is no staff there to paste on"));
  return skipped;
}

// ---- Explode and implode ---------------------------------------------------------------------

const NOT_PITCHED = () => tr("Drums and chord names are not exploded or imploded: select staves of notes");
const pitchedLane = (score, s) => !M.isDrums(score, s) && !M.isChords(score, s) && !M.isFigures(score, s);
const samePitch = (x, y) => x.d === y.d && x.alter === y.alter;

/** The staves the ranges cover, by their first lanes, top to bottom. */
const stavesOf = (score, ranges) => [...new Set(ranges.map((r) => M.upperOf(score, r.s)))];

/** Copied event `content` keeping one note of its chord, `p`: its reminders and fingering on that note only. */
function onePitch(content, p) {
  const c = { ...content, pitches: [{ ...p }], arpeggio: false };
  for (const field of ["forced", "cautionary", "harmonics"]) {
    if (!c[field]) continue;
    c[field] = c[field].filter((d) => d === p.d);
    if (!c[field].length) delete c[field];
  }
  if (c.fingers) {
    c.fingers = c.fingers.filter((f) => f.head == null || f.head === p.d);
    if (!c.fingers.length) delete c.fingers;
  }
  return c;
}

/**
 * The chords of the first staff the ranges cover spread over the staves
 * under it they cover: the top note on the first, the next on the next — a
 * chord of fewer notes giving its lowest to the staves left, a single note
 * going to all. One staff alone: onto as many staves under it as its largest
 * chord needs. The words, chord symbols and texts stay on the first staff;
 * a tie holds where a staff keeps its pitch.
 */
export function explode(score, ranges) {
  const staves = stavesOf(score, ranges);
  const source = ranges.find((r) => r.s === staves[0]) ?? ranges[0];
  if (!pitchedLane(score, source.s)) throw new Error(NOT_PITCHED());
  refuseTuplets(score, [source]);
  const clip = M.copy(score, source.s, source.a, source.b);
  const widest = Math.max(0, ...clip.map((piece) => (piece.content.rest ? 0 : piece.content.pitches.length)));
  let targets = staves.slice(1);
  if (staves.length < 2) {
    if (widest < 2) throw new Error(tr("There is no chord in the selection to explode"));
    const top = M.upperOf(score, source.s);
    targets = M.staffLanes(score).filter((u) => u > top && pitchedLane(score, u)).slice(0, widest - 1);
    if (targets.length < widest - 1) throw new Error(tr("The largest chord has {n} notes: it needs {m} staves under its own", { n: widest, m: widest - 1 }));
  }
  if (targets.some((u) => !pitchedLane(score, u))) throw new Error(NOT_PITCHED());
  const t0 = M.starts(score.staves[source.s])[source.a];
  [source.s, ...targets].forEach((lane, k) => {
    const pieces = clip.map((piece) => {
      let c = structuredClone(piece.content);
      if (!c.rest) {
        const high = [...c.pitches].sort((x, y) => y.d - x.d || y.alter - x.alter);
        c = onePitch(c, high[Math.min(k, high.length - 1)]);
      }
      if (k > 0) {
        Object.assign(c, { lyric: null, verses: [], chord: "", texts: [] });
        delete c.fret;
        delete c.fretBelow;
      }
      return { ...piece, content: c };
    });
    // A tie holds to the same pitch only; out of the selection, on the first staff alone.
    pieces.forEach((piece, j) => {
      const next = pieces[j + 1]?.content;
      if (piece.content.tie && (next ? next.rest || !samePitch(next.pitches[0], piece.content.pitches[0]) : k > 0)) piece.content.tie = false;
    });
    M.paste(score, lane, t0, pieces);
  });
}

/**
 * The notes of the other ranges merged as chords into the first's, where
 * one starts with a note of the first (or a rest) and lasts as long. The
 * first range is the first staff (or voice 1); a voice of its own staff
 * merged leaves rests where its notes were, another staff is left as it
 * is. Refused when nothing matches.
 */
export function implode(score, ranges) {
  if (ranges.length < 2) throw new Error(tr("Select several staves (Shift+click), or every voice of a staff, to merge them into chords"));
  const [into, ...others] = ranges;
  if (!pitchedLane(score, into.s)) throw new Error(NOT_PITCHED());
  const sources = others.filter((r) => pitchedLane(score, r.s));
  const staff = score.staves[into.s];
  const at = M.starts(staff);
  const emptied = [];
  let merged = 0;
  for (let i = into.a; i <= into.b; i++) {
    const ev = staff.events[i];
    if (ev.tuplet) continue;
    const length = M.ticksOf(ev);
    const found = [];
    for (const r of sources) {
      const lane = score.staves[r.s];
      const j = M.eventAt(lane, at[i]);
      if (j < r.a || j > r.b || lane.events[j].rest || lane.events[j].tuplet || M.ticksOf(lane.events[j]) !== length) continue;
      found.push(...lane.events[j].pitches);
      if (M.upperOf(score, r.s) === M.upperOf(score, into.s)) emptied.push([r.s, at[i]]);
    }
    if (!found.length) continue;
    const union = [];
    for (const p of [...(ev.rest ? [] : ev.pitches), ...found]) if (!union.some((q) => samePitch(p, q))) union.push({ d: p.d, alter: p.alter });
    ev.pitches = union.sort((x, y) => x.d - y.d || x.alter - y.alter);
    if (ev.rest) {
      ev.rest = false;
      delete ev.spacer;
    }
    merged++;
  }
  if (!merged) throw new Error(tr("The rhythms do not match anywhere: there is nothing to merge"));
  // The voices merged: their notes are the chords' now.
  for (const [lane, t] of emptied.sort((x, y) => y[1] - x[1])) {
    const i = M.eventAt(score.staves[lane], t);
    if (i >= 0) M.remove(score, lane, i);
  }
}
