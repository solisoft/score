// The score read over as a copyist would (#1022): what a player would stop
// at, said in plain words — a note out of its instrument's range or out of
// where it is comfortable, a bar the text wrote too short or too long, a
// part that starts, or comes back after a long rest, with no dynamic.
//
// Pure: `review(score, opts)` answers the remarks, and the editor's Review
// panel (studio-review.js) lists them. Each remark has an `id`, "rule:tick",
// by which the person sets it aside: kept on the score's settings line
// (score-model.js, META_KEYS' `review`), so it stays aside after a reload
// and for whoever the score is shared with.
//
//   node --test tests/js/review.test.mjs

const V = new URL(import.meta.url).search;
const { tr, language } = await import(`./words.js${V}`);
const M = await import(`./score-model.js${V}`);

/** The rules, in the order the panel lists them: what is wrong first, what is only worth a look last. */
export const RULES = ["range", "bars", "dynamic", "comfort"];

/** Bars of rest after which a part that comes back is given its dynamic again. */
export const REST_BARS = 4;

const SHARP_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const FRENCH = { C: "do", D: "ré", E: "mi", F: "fa", G: "sol", A: "la", B: "si" };
const SIGNS = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };

/** A letter, its sign and its octave as the page's language says them: "G3", or "sol2" (French counts middle C do3). */
function said(letter, sign, octave) {
  return language() === "fr" ? `${FRENCH[letter]}${sign}${octave - 1}` : `${letter}${sign}${octave}`;
}

/** A pitch of the model (`d`, c' being 7, and `alter`) by its name: "F♯4", "fa♯3". */
export function pitchWord(p) {
  const step = ((p.d % 7) + 7) % 7;
  return said(LETTERS[step], SIGNS[p.alter] ?? "", Math.floor(p.d / 7) + 3);
}

/** A MIDI key by its name, spelt as it is usually written: "E3", "si♭1". */
export function keyWord(key) {
  const name = SHARP_NAMES[((key % 12) + 12) % 12];
  return said(name[0], name.slice(1), Math.floor(key / 12) - 1);
}

/**
 * How far a staff's notes are written from how they sound: `{ steps,
 * semitones }`, from its transposition (score-model.js transpositionOf,
 * `\transpose c d` for a clarinet in B♭), or null for a staff written as it sounds.
 */
export function writtenShift(staff) {
  const to = M.transpositionOf(staff);
  if (!to) return null;
  const match = /^([a-g])((?:is|es|s)*)([',]*)$/.exec(to);
  if (!match) return null;
  const step = "cdefgab".indexOf(match[1]);
  const alter = (match[2].match(/is/g)?.length ?? 0) - (match[2].match(/es/g)?.length ?? 0) - (match[2] === "s" ? 1 : 0);
  const octaves = (match[3].match(/'/g)?.length ?? 0) - (match[3].match(/,/g)?.length ?? 0);
  return { steps: step + 7 * octaves, semitones: [0, 2, 4, 5, 7, 9, 11][step] + alter + 12 * octaves };
}

/** A number of beats as said: "3", "1.5" — "1,5" in French. */
function beats(n) {
  const text = String(Number(n.toFixed(2)));
  return language() === "fr" ? text.replace(".", ",") : text;
}

/** A staff's name, as the score names it: its own, its instrument's, or its number. */
function defaultName(score, lane) {
  const upper = M.upperOf(score, lane);
  const staff = score.staves[upper];
  const known = M.INSTRUMENTS[M.instrumentOf(score, upper)]?.name;
  return staff.name || known || tr("Staff {n}", { n: M.staffLanes(score).indexOf(upper) + 1 });
}

/** Whether lane `s` holds notes the rules read: not a line of chord names, nor a figured bass. */
const isMusic = (score, s) => !M.isChords(score, s) && !M.isFigures(score, s);

/** Whether event `ev` sounds: a note, not a cue (another part's, not played). */
const sounds = (ev) => !ev.rest && ev.pitches.length > 0 && !ev.cue;

// ---- Range ------------------------------------------------------------------------------------

/**
 * Each bar's notes out of the range, and out of where it is comfortable, of
 * lane `s`'s instrument — the one played at each note, when the staff
 * changes instrument on the way (#1023), named then.
 */
function rangeRemarks(score, s, name) {
  if (M.isDrums(score, s)) return [];
  const upper = M.upperOf(score, s);
  const own = M.instrumentOf(score, upper);
  // By bar and by what is wrong, the note furthest out: one remark a bar, not one a note.
  const worst = new Map();
  const keep = (kind, bar, t, p, key, shift, k, further) => {
    const id = `${kind}:${M.barStart(score, bar)}`;
    const was = worst.get(id);
    if (!was || further(key, was.key)) worst.set(id, { kind, bar, t, p, key, shift, k });
  };
  const events = score.staves[s].events;
  const at = M.starts(score.staves[s]);
  events.forEach((ev, i) => {
    if (!sounds(ev)) return;
    // A note tied on from the one before is that note: said once.
    const before = events[i - 1];
    if (before?.tie && !before.rest && before.pitches.length === ev.pitches.length) return;
    const k = M.instrumentAt(score, s, at[i]);
    const instrument = M.INSTRUMENTS[k];
    if (!instrument?.range) return;
    const [low, high] = instrument.range;
    const [easyLow, easyHigh] = instrument.comfortable ?? instrument.range;
    const bar = M.barAt(score, at[i]);
    // Written as the player reads it there: a staff's \\transposition may change on the way.
    const shift = M.writtenShiftAt(score, s, at[i]);
    for (const pitch of ev.pitches) {
      const p = shift ? M.transposePitch(pitch, shift.steps, shift.semitones) : pitch;
      const key = M.midiKey(p.d, p.alter);
      if (key < low) keep("low", bar, at[i], p, key, shift, k, (a, b) => a < b);
      else if (key > high) keep("high", bar, at[i], p, key, shift, k, (a, b) => a > b);
      else if (key < easyLow) keep("lowish", bar, at[i], p, key, shift, k, (a, b) => a < b);
      else if (key > easyHigh) keep("highish", bar, at[i], p, key, shift, k, (a, b) => a > b);
    }
  });
  return [...worst.entries()].map(([id, w]) => {
    const instrument = M.INSTRUMENTS[w.k];
    const [low, high] = instrument.range;
    const [easyLow, easyHigh] = instrument.comfortable ?? instrument.range;
    const words = { name: w.k === own ? name : tr(instrument.name), note: pitchWord(w.p) };
    let text;
    if (w.kind === "low" || w.kind === "high") {
      const limit = keyWord(w.kind === "low" ? low : high);
      if (w.shift) text = w.kind === "low" ? tr("{name}: written {note} is out of its range (the lowest written note is {limit})", { ...words, limit }) : tr("{name}: written {note} is out of its range (the highest written note is {limit})", { ...words, limit });
      else text = w.kind === "low" ? tr("{name}: {note} is out of its range (the lowest note is {limit})", { ...words, limit }) : tr("{name}: {note} is out of its range (the highest note is {limit})", { ...words, limit });
      return { lane: s, bar: w.bar, t: w.t, rule: "range", level: "error", id, text };
    }
    const span = { ...words, low: keyWord(easyLow), high: keyWord(easyHigh) };
    text = w.shift ? tr("{name}: written {note} lies outside the comfortable range (written {low} to {high})", span) : tr("{name}: {note} lies outside the comfortable range ({low} to {high})", span);
    return { lane: s, bar: w.bar, t: w.t, rule: "comfort", level: "hint", id, text };
  });
}

// ---- Bars that do not add up ----------------------------------------------------------------

/** The bars the text wrote too short or too long (score-model.js unevenBars, read with the text). */
function barRemarks(score, uneven, nameOf) {
  return (uneven ?? []).filter((u) => score.staves[u.lane]).map((u) => {
    const time = M.timeAt(score, Math.min(u.bar, M.barsOf(score) - 1));
    const beat = M.WHOLE / time[1];
    const text = tr("{name}: {have} beats instead of {want} ({metre})", { name: nameOf(u.lane), have: beats(u.have / beat), want: beats(u.want / beat), metre: `${time[0]}/${time[1]}` });
    return { lane: u.lane, bar: u.bar, t: u.t, rule: "bars", level: "error", id: `bars:${u.t}`, text };
  });
}

// ---- No dynamic to start --------------------------------------------------------------------

/**
 * The staves read together for their dynamics: each alone, but a keyboard's
 * or a harp's two staves, whose dynamics are often written on one of them.
 */
function dynamicGroups(score) {
  const groups = [];
  let before = null;
  for (const u of M.staffLanes(score)) {
    if (!isMusic(score, u)) continue;
    const staff = score.staves[u];
    const family = M.INSTRUMENTS[M.instrumentOf(score, u)]?.family;
    const twoHands = (family === "Keyboards" || M.INSTRUMENTS[M.instrumentOf(score, u)]?.name === "Harp") && !staff.drums;
    if (twoHands && before && before.instrument === staff.instrument && before.twoHands && groups[groups.length - 1].length === 1) groups[groups.length - 1].push(u);
    else groups.push([u]);
    before = { instrument: staff.instrument, twoHands };
  }
  return groups;
}

/** Where a staff (or a keyboard's two) starts to play, and comes back after REST_BARS bars of rest, with no dynamic. */
function dynamicRemarks(score, staves, nameOf) {
  const items = [];
  for (const u of staves) {
    for (const lane of M.voiceLanes(score, u)) {
      const events = score.staves[lane].events;
      const at = M.starts(score.staves[lane]);
      events.forEach((ev, i) => items.push({ t: at[i], end: at[i] + M.ticksOf(ev), ev, lane: u, tied: Boolean(events[i - 1]?.tie && !events[i - 1].rest) }));
    }
  }
  items.sort((a, b) => a.t - b.t);
  const out = [];
  let lastEnd = null;
  // A dynamic written since the last note sounded: on a rest before the entry, or on the entry.
  let marked = false;
  for (let k = 0; k < items.length;) {
    const t = items[k].t;
    const now = [];
    while (k < items.length && Math.abs(items[k].t - t) < 1e-6) now.push(items[k++]);
    if (now.some((it) => it.ev.dynamic)) marked = true;
    const entering = now.filter((it) => sounds(it.ev) && !it.tied);
    const soundingEnd = Math.max(lastEnd ?? 0, ...now.filter((it) => sounds(it.ev)).map((it) => it.end));
    if (!entering.length) {
      // A note tied on sounds on: no entry, but the rest after it starts later.
      if (now.some((it) => sounds(it.ev))) lastEnd = soundingEnd;
      continue;
    }
    let rested = 0;
    if (lastEnd != null) {
      const firstSilent = M.isBarLine(score, lastEnd) ? M.barAt(score, lastEnd) : M.barAt(score, lastEnd) + 1;
      rested = M.barAt(score, t) - firstSilent;
    }
    if ((lastEnd == null || rested >= REST_BARS) && !marked) {
      const lane = entering[0].lane;
      const name = nameOf(lane);
      const text = lastEnd == null ? tr("{name}: the first note has no dynamic", { name }) : tr("{name}: comes back after {n} bars of rest with no dynamic", { name, n: rested });
      out.push({ lane, bar: M.barAt(score, t), t, rule: "dynamic", level: "warning", id: `dynamic:${t}`, text });
    }
    lastEnd = soundingEnd;
    marked = false;
  }
  return out;
}

// ---- All of it --------------------------------------------------------------------------------

/**
 * The remarks on `score`, in the order of its bars: [{ lane, bar, t, rule,
 * level, id, text, ignored }] — `rule` one of RULES, `level` "error",
 * "warning" or "hint", `t` the tick of the note (or the bar) it is about.
 *
 * opts:
 * - `uneven`: the bars the text wrote too short or too long, as fromParsed
 *   read them with the text (its `uneven`); none once the score is edited.
 * - `name(lane)`: a staff's name as the page says it (its instrument's in
 *   the page's language); by default, as the score names it.
 * - `ignored`: the remarks set aside, a Set of "lane/rule:tick"; by default
 *   the score's own (M.reviewIgnored).
 */
export function review(score, opts = {}) {
  if (!score?.staves?.length) return [];
  const nameOf = (lane) => (opts.name ? opts.name(M.upperOf(score, lane)) : defaultName(score, lane));
  const ignored = opts.ignored ?? M.reviewIgnored(score);
  const remarks = [];
  score.staves.forEach((_, s) => {
    if (isMusic(score, s)) remarks.push(...rangeRemarks(score, s, nameOf(s)));
  });
  remarks.push(...barRemarks(score, opts.uneven, nameOf));
  for (const staves of dynamicGroups(score)) remarks.push(...dynamicRemarks(score, staves, nameOf));
  for (const remark of remarks) remark.ignored = ignored.has(`${remark.lane}/${remark.id}`);
  return remarks.sort((a, b) => a.bar - b.bar || a.lane - b.lane || RULES.indexOf(a.rule) - RULES.indexOf(b.rule) || a.t - b.t);
}

/** The heading of a rule's remarks in the panel. */
export function ruleTitle(rule) {
  return {
    range: tr("Out of range"),
    bars: tr("Bars that do not add up"),
    dynamic: tr("No dynamic to start with"),
    comfort: tr("Outside the comfortable range"),
  }[rule] ?? rule;
}
