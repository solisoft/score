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

/** The ranges whose lanes hold pitched notes: not a drum staff, a line of chord names or a figured bass. */
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
  const fits = (ev) => !ev.rest || name === "fermata";
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
