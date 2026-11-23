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
