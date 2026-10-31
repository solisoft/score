// Notes made from a pattern, written into the score: a drum bar from a grid
// of steps, chords broken into arpeggios, and an accompaniment from the
// chord symbols. Each is one edit on the model (studio.js runs it inside
// `edit`, so one Undo takes it back); the dialogs are pattern-tools.js's.
//
// No DOM here: tests/js/patterns.test.mjs calls these on scores the real
// engraver read.

// The model at the same version as the page's, so its event ids are one series.
const M = await import(`./score-model.js${new URL(import.meta.url).search}`);
// Chord symbols are read in voicings.js, at the page's version: the
// accompaniments and the chord diagrams read them the one way.
const V = await import(`./voicings.js${new URL(import.meta.url).search}`);
export const { chordTones, chordVoicing, chordSymbols } = V;
// The grooves of the drum grid's Groove menu (#442).
const D = await import(`./drums.js${new URL(import.meta.url).search}`);

// ---- The drum grid -----------------------------------------------------------------

/** The grid's rows, top to bottom: cymbals, hi-hats, toms, snare, kick. */
export const GRID_DRUMS = ["cymc", "cymr", "hho", "hh", "tomh", "tommh", "tomfh", "sn", "bd"];

/** A step of the grid: a sixteenth. */
export const GRID_STEP = M.WHOLE / 16;

/** Bar `b`'s beat in ticks: a dotted quarter in 6/8, 9/8, 12/8; else the metre's unit. */
export function beatTicks(score, b) {
  const [num, den] = M.timeAt(score, b);
  return den === 8 && num % 3 === 0 && num > 3 ? (3 * M.WHOLE) / 8 : M.WHOLE / den;
}

/**
 * Bar `b` of drum lane `s` as a grid: { bar, steps, rows: { drum: [0|1|2…] },
 * others, fits }. A cell is 0 (silent), 1 (struck) or 2 (struck with an
 * accent: the accent is the stroke's, every drum of it). `others` keeps, by
 * step, the drums struck that the grid has no row for, so writing it back
 * keeps them; `fits` is false when a stroke falls between the steps (a
 * triplet, a 32nd), which writing the grid moves onto them.
 */
export function drumGrid(score, s, b) {
  if (!M.isDrums(score, s)) throw new Error("The drum grid is a drum staff's: select a bar of one");
  const staff = score.staves[s];
  const t0 = M.barStart(score, b);
  const len = M.barLength(score, b);
  const steps = Math.max(1, Math.round(len / GRID_STEP));
  const rows = Object.fromEntries(GRID_DRUMS.map((name) => [name, Array(steps).fill(0)]));
  const others = Array.from({ length: steps }, () => []);
  let fits = true;
  const at = M.starts(staff);
  staff.events.forEach((ev, i) => {
    if (at[i] < t0 || at[i] >= t0 + len || ev.rest) return;
    // A note tied on from before is not struck again.
    if (staff.events[i - 1]?.tie) return;
    const step = (at[i] - t0) / GRID_STEP;
    if (!Number.isInteger(step) || ev.tuplet) fits = false;
    const k = Math.min(steps - 1, Math.round(step));
    const value = ev.arts.includes("accent") ? 2 : 1;
    for (const p of ev.pitches) {
      if (rows[p.drum]) rows[p.drum][k] = Math.max(rows[p.drum][k], value);
      else if (p.drum && !others[k].includes(p.drum)) others[k].push(p.drum);
    }
  });
  return { bar: b, steps, rows, others, fits };
}

/**
 * Bar `b` as a grid holding `lines` (a groove's basic bar or its break, from
 * drums.js) written in `time`: each line's steps spread over the grid's —
 * twelve eighths of a 12/8 on its twenty-four sixteenths. The drums the grid
 * has no row for go to `others`. Throws when the bar is in another metre.
 */
export function grooveGrid(score, b, lines, time) {
  const bar = M.timeAt(score, b).join("/");
  if (bar !== time) throw new Error(`This groove is in ${time} and bar ${b + 1} in ${bar}: choose a groove in ${bar}`);
  const steps = Math.max(1, Math.round(M.barLength(score, b) / GRID_STEP));
  const rows = Object.fromEntries(GRID_DRUMS.map((name) => [name, Array(steps).fill(0)]));
  const others = Array.from({ length: steps }, () => []);
  for (const [name, line] of Object.entries(lines)) {
    const per = steps / line.length;
    if (!Number.isInteger(per)) throw new Error(`The ${name} line has ${line.length} steps: a bar of ${time} takes ${steps}, or a divisor of it`);
    [...line].forEach((c, k) => {
      if (c !== "x" && c !== "X" && c !== "g") return;
      const value = c === "X" ? 2 : 1;
      if (rows[name]) rows[name][k * per] = Math.max(rows[name][k * per], value);
      else if (!others[k * per].includes(name)) others[k * per].push(name);
    });
  }
  return { bar: b, steps, rows, others, fits: true };
}

/**
 * A groove written into bars `a` to `b` of drum lane `s`: its basic bar in
 * each, its break in the last bar of each four and in the last one, when
 * `breaks`. Answers the number of bars written.
 */
export function writeGroove(score, s, a, b, groove, { breaks = true, feel = false } = {}) {
  if (!M.isDrums(score, s)) throw new Error("A groove is a drum staff's: select bars of one");
  for (let bar = a; bar <= b; bar++) {
    const breaking = breaks && ((bar - a) % 4 === 3 || (bar === b && bar > a));
    const n = (bar - a) % 4;
    const lines = breaking ? D.breakOf(groove) : D.variedBar(groove.main, n, { crash: bar - a >= 4 });
    writeDrumBar(score, s, bar, lines, groove.time, { fill: breaking });
  }
  if (feel) humanizeDrums(score);
  return b - a + 1;
}

/**
 * Bar `bar` of drum lane `s` written from `lines` (a bar of `time`, as
 * drums.js has them), each stroke at the force a drummer plays it with
 * (drums.js dynamicsOf): kept as the notes' velocities (velocity.js, the
 * MIDI view's strip), the bar's earlier ones on that lane replaced (#455).
 */
export function writeDrumBar(score, s, bar, lines, time, { fill = false } = {}) {
  const grid = grooveGrid(score, bar, lines, time);
  writeDrumGrid(score, s, grid);
  const t0 = M.barStart(score, bar);
  const t1 = M.barStart(score, bar + 1);
  const steps = Math.max(...Object.values(lines).map((line) => line.length));
  const step = (t1 - t0) / steps;
  const kept = Object.fromEntries(Object.entries(score.meta?.velocity ?? {}).filter(([id]) => {
    const [lane, tick] = id.split(":").map(Number);
    return lane !== s || tick < t0 || tick >= t1;
  }));
  for (const stroke of D.dynamicsOf(lines, time, { fill })) {
    kept[`${s}:${t0 + stroke.at * step}:${M.drumKey(stroke.drum)}`] = stroke.velocity;
  }
  score.meta = { ...(score.meta ?? {}), velocity: kept };
}

/** The score played with a drummer's small unevenness (drums.js DRUMMER_FEEL), unless it has a humanize of its own. */
export function humanizeDrums(score) {
  if (score.meta?.humanize) return;
  score.meta = { ...(score.meta ?? {}), humanize: { ...D.DRUMMER_FEEL } };
}

/** A grid cell's next value on a click: silent, struck, accented, silent again. */
export function nextCell(value) {
  return (value + 1) % 3;
}

/**
 * The grid written into its bar of drum lane `s`, over what was there: each
 * step struck is a note (a chord of drums) lasting to the next one struck or
 * the end of its beat, whichever comes first; rests between.
 */
export function writeDrumGrid(score, s, grid) {
  if (!M.isDrums(score, s)) throw new Error("The drum grid is a drum staff's: select a bar of one");
  const t0 = M.barStart(score, grid.bar);
  const len = M.barLength(score, grid.bar);
  const beat = beatTicks(score, grid.bar);
  M.write(score, s, t0, len, { rest: true });
  const struck = [];
  for (let k = 0; k < grid.steps; k++) {
    const names = [...GRID_DRUMS.filter((name) => grid.rows[name]?.[k] > 0), ...(grid.others?.[k] ?? [])];
    if (!names.length) continue;
    const accent = GRID_DRUMS.some((name) => grid.rows[name]?.[k] > 1);
    struck.push({ t: t0 + k * GRID_STEP, names, accent });
  }
  struck.forEach((hit, n) => {
    const next = struck[n + 1]?.t ?? t0 + len;
    const beatEnd = t0 + (Math.floor((hit.t - t0) / beat) + 1) * beat;
    const end = Math.min(next, beatEnd, t0 + len);
    const pitches = hit.names.map((name) => M.drumPitch(name)).sort((x, y) => x.d - y.d);
    M.write(score, s, hit.t, end - hit.t, { rest: false, pitches, arts: hit.accent ? ["accent"] : [] });
  });
}

// ---- Arpeggios ---------------------------------------------------------------------

/** The arpeggiator's patterns, and its steps: an eighth, a sixteenth, an eighth of a triplet. */
export const ARP_PATTERNS = ["up", "down", "up-down", "random"];
export const ARP_STEPS = { 8: M.WHOLE / 8, 16: M.WHOLE / 16, "8t": M.WHOLE / 12 };

const keyOf = (p) => M.midiKey(p.d, p.alter);

/** A chord's notes, low to high, over `octaves` octaves: what an arpeggio runs through. */
export function arpeggioPool(pitches, octaves = 1) {
  const seen = new Set();
  const base = [...pitches].sort((x, y) => keyOf(x) - keyOf(y)).filter((p) => !seen.has(keyOf(p)) && seen.add(keyOf(p)));
  const pool = [];
  for (let o = 0; o < Math.max(1, octaves); o++) {
    for (const p of base) {
      const q = { d: p.d + 7 * o, alter: p.alter };
      if (keyOf(q) <= 108 && q.d <= 42) pool.push(q);
    }
  }
  return pool.length ? pool : base;
}

/** The `k`th note of an arpeggio over `pool` in `pattern`; `random` answers a number in [0, 1). */
export function arpeggioNote(pool, pattern, k, random = Math.random, last = null) {
  const n = pool.length;
  if (pattern === "down") return pool[n - 1 - (k % n)];
  if (pattern === "up-down") {
    if (n < 2) return pool[0];
    const cycle = 2 * n - 2;
    const at = k % cycle;
    return pool[at < n ? at : cycle - at];
  }
  if (pattern === "random") {
    if (n < 2) return pool[0];
    // Never the same note twice running.
    let pick = Math.floor(random() * n) % n;
    if (last && keyOf(pool[pick]) === keyOf(last)) pick = (pick + 1) % n;
    return pool[pick];
  }
  return pool[k % n];
}

/** Notes, one a step, from `t` to `end` of lane `s`: `noteAt(k)` the kth's pitch. Triplets go a quarter at a time. */
function writeRun(score, s, t, end, step, noteAt) {
  const staff = score.staves[s];
  let k = 0;
  let now = t;
  const triplet = step === ARP_STEPS["8t"];
  const quarter = M.WHOLE / 4;
  while (now < end) {
    if (triplet && now + quarter <= end && M.barAt(score, now) === M.barAt(score, now + quarter - 1)) {
      const i = M.tupletAt(score, s, now, quarter, 3);
      for (let j = 0; j < 3; j++) Object.assign(staff.events[i + j], { rest: false, pitches: [noteAt(k++)] });
      now += quarter;
      continue;
    }
    const len = Math.min(triplet ? M.WHOLE / 8 : step, end - now);
    M.write(score, s, now, len, { rest: false, pitches: [noteAt(k++)] });
    now += len;
  }
}

/** What stays on the first note of what is written over: the chord symbol, the dynamic, the words. */
const KEPT = (ev) => ({ chord: ev.chord, dynamic: ev.dynamic, texts: ev.texts });

/**
 * Lane `s`'s chords from event `a` to `b` broken into arpeggios: `pattern`
 * one of ARP_PATTERNS, `step` a key of ARP_STEPS, over `octaves` (1–3). A
 * chord held over a tie is one; a single note is broken over its octaves,
 * and left alone with one. Answers how many chords were broken.
 */
export function arpeggiate(score, s, a, b, { pattern = "up", step = "16", octaves = 1, random = Math.random } = {}) {
  if (M.isDrums(score, s)) throw new Error("A drum staff has no chords to break: the arpeggiator is for pitched staves");
  if (!ARP_PATTERNS.includes(pattern)) throw new Error(`no arpeggio pattern called ${pattern}`);
  const stepTicks = ARP_STEPS[step];
  if (!stepTicks) throw new Error("an arpeggio's step is an eighth, a sixteenth or a triplet");
  const staff = score.staves[s];
  const at = M.starts(staff);
  const spans = [];
  for (let i = a; i <= b && i < staff.events.length; i++) {
    const ev = staff.events[i];
    let j = i;
    while (staff.events[j].tie && j + 1 < staff.events.length) j++;
    const span = { t: at[i], end: at[j] + M.ticksOf(staff.events[j]), pitches: ev.pitches, kept: KEPT(ev) };
    const tuplet = staff.events.slice(i, j + 1).some((x) => x.tuplet);
    if (!ev.rest && !tuplet && (ev.pitches.length > 1 || octaves > 1)) spans.push(span);
    i = j;
  }
  if (!spans.length) throw new Error("Select chords to break: the arpeggiator turns a chord's notes into a run");
  for (const span of spans) {
    const pool = arpeggioPool(span.pitches, octaves);
    let last = null;
    writeRun(score, s, span.t, span.end, stepTicks, (k) => (last = arpeggioNote(pool, pattern, k, random, last)));
    const first = staff.events[M.eventAt(staff, span.t)];
    if (first) Object.assign(first, structuredClone(span.kept));
  }
  return spans.length;
}

// ---- The chord track ---------------------------------------------------------------

export const ACCOMPANIMENTS = ["block", "arpeggio", "bass-chord"];

/**
 * An accompaniment from the chord symbols, written into lane `s` over bars
 * `a` to `b` (all of them by default), over what was there: each chord held
 * until the next, struck again each bar — as `block` chords, an `arpeggio`
 * in eighths, or `bass-chord`, its bass on the first beat and the chord on
 * the others. A chord symbol on that lane stays where it was. Answers how
 * many chords were written.
 */
export function chordTrack(score, s, { style = "block", a = 0, b = null } = {}) {
  if (!score.staves[s]) throw new Error("no such staff");
  if (M.isDrums(score, s)) throw new Error("A drum staff takes no chords: choose a staff of notes for the chord track");
  if (!ACCOMPANIMENTS.includes(style)) throw new Error(`no accompaniment called ${style}`);
  const last = b ?? M.barsOf(score) - 1;
  const t0 = M.barStart(score, a);
  const t1 = M.barStart(score, last + 1);
  const all = chordSymbols(score);
  const inside = all.filter((c) => c.t >= t0 && c.t < t1);
  // The chord sounding as the bars start, set before them.
  const before = all.filter((c) => c.t < t0).at(-1);
  const symbols = before && !inside.some((c) => c.t === t0) ? [{ ...before, t: t0 }, ...inside] : inside;
  if (!symbols.length) throw new Error("No chord symbols there: add some with Insert ▸ Chord symbol (Ctrl+K), or ask the AI to suggest chords");
  const low = ["bass", "bass_8"].includes(M.clefAt(score, s, a));
  const from = low ? 0 : 7;
  const kept = chordSymbols({ staves: [score.staves[s]] }).filter((c) => c.t >= t0 && c.t < t1);
  M.write(score, s, t0, t1 - t0, { rest: true });
  symbols.forEach((symbol, n) => {
    const end = symbols[n + 1]?.t ?? t1;
    const voicing = chordVoicing(symbol.text, from);
    let start = symbol.t;
    while (start < end) {
      const stop = Math.min(end, M.nextBarLine(score, start));
      writeAccompaniment(score, s, start, stop, voicing, style);
      start = stop;
    }
  });
  const staff = score.staves[s];
  for (const c of kept) {
    const i = M.eventAt(staff, c.t);
    if (i >= 0) staff.events[i].chord = c.text;
  }
  return symbols.length;
}

function writeAccompaniment(score, s, t, end, voicing, style) {
  const chord = voicing.pitches;
  if (style === "arpeggio") {
    const pool = arpeggioPool([voicing.bass, ...chord], 1);
    return writeRun(score, s, t, end, ARP_STEPS[8], (k) => arpeggioNote(pool, "up-down", k));
  }
  if (style === "block") return M.write(score, s, t, end - t, { rest: false, pitches: [voicing.bass, ...chord] });
  // Bass on the beat the chord starts on, the chord on each beat after it.
  const b = M.barAt(score, t);
  const beat = beatTicks(score, b);
  const bar0 = M.barStart(score, b);
  let now = t;
  let first = true;
  while (now < end) {
    const stop = Math.min(end, bar0 + (Math.floor((now - bar0) / beat) + 1) * beat);
    M.write(score, s, now, stop - now, { rest: false, pitches: first ? [voicing.bass] : chord });
    first = false;
    now = stop;
  }
}
