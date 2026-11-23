// Cues (#1023): a player coming back after four bars of rest or more reads,
// small over the last bar or two of the rests, what another part plays
// meanwhile — the most audible one there — so as to come in at the right
// moment. The Review proposes them (review.js); "Add" writes them as cue
// notes, a CueVoice beside the part's own rests — what LilyPond's
// \cueDuring makes, and what the editor reads a \cueDuring as — drawn
// small and not played; "Remove cue" takes them away.

const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);
const M = await import(`./score-model.js${V}`);

/** The bars of rest, at least, before an entry that a cue is proposed for. */
export const CUE_REST_BARS = 4;
/** The bars of rest before the entry a cue goes over, at most. */
export const CUE_BARS = 2;

/** How loud a dynamic is, for the part heard most: pp 2 … ff 7. */
const LOUDNESS = { ppppp: 0, pppp: 0, ppp: 1, pp: 2, p: 3, mp: 4, mf: 5, f: 6, ff: 7, fff: 8, ffff: 9, fffff: 9, fp: 6, sf: 6, sfz: 7, sff: 7, sfp: 6, fz: 6, rfz: 6 };

/** Whether the staff of lane `u` is one a cue may go on, or come from: music, of one part, edited by the model. */
function cueStaff(score, u) {
  return !M.isDrums(score, u) && !M.isChords(score, u) && !M.isFigures(score, u) && !M.isRaw(score, u) && !M.isCombined(score, u) && !M.isAutoChange(score, u);
}

/** Lane `lane`'s events from `from` to `to` (ticks), as { ev, t, end }. */
function eventsIn(score, lane, from, to) {
  const staff = score.staves[lane];
  const at = M.starts(staff);
  return staff.events.map((ev, i) => ({ ev, i, t: at[i], end: at[i] + M.ticksOf(ev) })).filter((x) => x.t < to - 1e-6 && x.end > from + 1e-6);
}

/** Whether the staff of lane `u` plays in bar `b`: a note of its own, in any of its voices (cue notes are another part's). */
function plays(score, u, b) {
  const from = M.barStart(score, b);
  const to = M.barStart(score, b + 1);
  return M.voiceLanes(score, u).some((lane) => eventsIn(score, lane, from, to).some((x) => !x.ev.rest && !x.ev.cue));
}

/** Whether the staff of lane `u` has cue notes in bar `b`. */
function cued(score, u, b) {
  const from = M.barStart(score, b);
  const to = M.barStart(score, b + 1);
  return M.voiceLanes(score, u).some((lane) => eventsIn(score, lane, from, to).some((x) => x.ev.cue && !x.ev.rest));
}

/** How loud lane `lane` plays at `t`: its last dynamic up to there, mf when it has none. */
function loudnessAt(score, lane, t) {
  const staff = score.staves[lane];
  const at = M.starts(staff);
  let level = LOUDNESS.mf;
  staff.events.forEach((ev, i) => {
    if (at[i] <= t + 1e-6 && ev.dynamic && LOUDNESS[ev.dynamic] != null) level = LOUDNESS[ev.dynamic];
  });
  return level;
}

/** Whether `rank` comes before `other`: the first of their numbers that differs is larger. */
function louder(rank, other) {
  const k = rank.findIndex((x, n) => x !== other[n]);
  return k >= 0 && rank[k] > other[k];
}

/**
 * The part heard most from `from` to `to` (ticks), other than staff `u`'s:
 * { lane, notes } — the loudest, then the one with more notes, then the
 * higher — or null when none plays.
 */
function heardMost(score, u, from, to) {
  let best = null;
  for (const v of M.staffLanes(score)) {
    if (v === u || !cueStaff(score, v)) continue;
    const notes = eventsIn(score, v, from, to).filter((x) => !x.ev.rest && !x.ev.cue && x.t >= from - 1e-6);
    if (!notes.length) continue;
    const top = Math.max(...notes.flatMap((x) => x.ev.pitches.map((p) => M.midiKey(p.d, p.alter))));
    const rank = [loudnessAt(score, v, to - 1), notes.length, top];
    if (!best || louder(rank, best.rank)) best = { lane: v, notes: notes.length, rank };
  }
  return best;
}

/**
 * The cues the score could have, and those it has: [{ lane, bar, t, rested,
 * from, to, source, cued }] — staff `lane` comes back in bar `bar` (at `t`)
 * after `rested` bars of rest, CUE_REST_BARS or more; the cue goes over bars `from` to
 * `to` - 1, from staff `source`'s notes. `cued`: the cue notes are there
 * already (from the bars of rest before the entry).
 */
export function cueProposals(score) {
  const out = [];
  const bars = M.barsOf(score);
  for (const u of M.staffLanes(score)) {
    if (!cueStaff(score, u)) continue;
    let rest = 0;
    for (let b = 0; b < bars; b++) {
      if (!plays(score, u, b)) {
        rest++;
        continue;
      }
      if (rest >= CUE_REST_BARS) {
        const first = b - Math.min(CUE_BARS, rest);
        const t = M.barStart(score, b);
        const there = Array.from({ length: b - first }, (_, k) => first + k).filter((x) => cued(score, u, x));
        if (there.length) out.push({ lane: u, bar: b, t, rested: rest, from: there[0], to: b, source: null, cued: true });
        else {
          const heard = heardMost(score, u, M.barStart(score, first), t);
          // The cue starts with the bar the part it shows plays in.
          let from = first;
          while (heard && from < b - 1 && !eventsIn(score, heard.lane, M.barStart(score, from), M.barStart(score, from + 1)).some((x) => !x.ev.rest)) from++;
          if (heard) out.push({ lane: u, bar: b, t, rested: rest, from, to: b, source: heard.lane, cued: false });
        }
      }
      rest = 0;
    }
  }
  return out;
}

/** Staff `u`'s second voice: made, rests to begin with, when it has none. */
function cueLane(score, u) {
  const lanes = M.voiceLanes(score, u);
  return lanes.length > 1 ? lanes[1] : M.addVoice(score, u, 2);
}

/**
 * The cue `cue` (as cueProposals answers it) written: staff `cue.source`'s
 * notes over bars `cue.from` … `cue.to` - 1, small, in staff `cue.lane`'s
 * second voice beside its rests — an octave up or down when that brings
 * them nearer its staff's middle. Refused when those bars are not all
 * rests there. Answers the lane written in.
 */
export function addCue(score, cue) {
  const u = M.upperOf(score, cue.lane);
  if (!cueStaff(score, u)) throw new Error(tr("A cue goes on a staff of one part, of notes"));
  if (!(cue.from < cue.to)) throw new Error(tr("no such bar"));
  for (let b = cue.from; b < cue.to; b++) {
    if (plays(score, u, b) || cued(score, u, b)) throw new Error(tr("A cue goes over rests: bar {bar} is not all rests", { bar: b + 1 }));
  }
  if (cue.source == null || !score.staves[cue.source] || !cueStaff(score, cue.source) || M.upperOf(score, cue.source) === u) throw new Error(tr("No other part plays there to cue"));
  const from = M.barStart(score, cue.from);
  const to = M.barStart(score, cue.to);
  // Whole notes inside the bars, as they are written there (a tuplet's left out: the part's rests stand).
  const notes = eventsIn(score, cue.source, from, to).filter((x) => !x.ev.rest && !x.ev.tuplet && x.t >= from - 1e-6);
  if (!notes.length) throw new Error(tr("No other part plays there to cue"));
  // An octave up or down, when it brings them nearer the middle of the staff.
  const middle = M.clefMiddle(M.clefAt(score, u, cue.from));
  const mean = notes.reduce((sum, x) => sum + x.ev.pitches.reduce((s2, p) => s2 + p.d, 0) / x.ev.pitches.length, 0) / notes.length;
  const octaves = Math.round((middle - mean) / 7);
  const lane = cueLane(score, u);
  for (const x of notes) {
    const end = Math.min(x.end, to);
    const pitches = x.ev.pitches.map((p) => ({ d: p.d + 7 * octaves, alter: p.alter }));
    M.write(score, lane, x.t, end - x.t, { rest: false, pitches, cue: true });
  }
  // Its rests in those bars are the cue's too: the CueVoice beside the part's own.
  const staff = score.staves[lane];
  const at = M.starts(staff);
  staff.events.forEach((ev, i) => {
    if (at[i] >= from - 1e-6 && at[i] < to - 1e-6) ev.cue = true;
  });
  return lane;
}

/** The cue notes over bars `from` … `to` - 1 of the staff of lane `s` taken away; its second voice too when nothing else is left in it. */
export function removeCue(score, s, from, to) {
  const u = M.upperOf(score, s);
  const start = M.barStart(score, from);
  const end = M.barStart(score, to);
  const inside = (lane) => {
    const at = M.starts(score.staves[lane]);
    return score.staves[lane].events.map((ev, i) => ({ ev, i, t: at[i] })).filter((x) => x.t >= start - 1e-6 && x.t < end - 1e-6 && x.ev.cue);
  };
  let found = false;
  for (const lane of M.voiceLanes(score, u)) {
    // One note at a time: taking one away may join the rests around it.
    for (let note = inside(lane).find((x) => !x.ev.rest); note; note = inside(lane).find((x) => !x.ev.rest)) {
      found = true;
      delete note.ev.cue;
      M.remove(score, lane, note.i);
    }
    for (const x of inside(lane)) {
      found = true;
      delete x.ev.cue;
    }
  }
  if (!found) throw new Error(tr("There is no cue there"));
  // A second voice of rests alone goes.
  const lanes = M.voiceLanes(score, u);
  if (lanes.length > 1 && lanes.slice(1).every((lane) => score.staves[lane].events.every((ev) => ev.rest && !ev.cue && !ev.dynamic && !ev.texts.length))) {
    for (let v = lanes.length; v >= 2; v--) M.removeVoice(score, u, v);
  }
}
