// Grace notes played as their kind asks (#389).
//
// eui-score plays every grace note the same way: on the beat, as long as
// it is written (half the note at most), the note it goes to starting that
// much later. This moves them, in the MIDI file it wrote, as they are played:
//
// - an acciaccatura (\acciaccatura, slashed), a plain \grace and a
//   \slashedGrace are short — a 32nd note or 60 ms, whichever is shorter at
//   the speed — and come just before the beat, taking their time from the
//   note before; the note itself is struck on the beat. With no note before
//   to take it from but at the very start, they take it from the note;
// - an appoggiatura (\appoggiatura) takes half of the note's value, two
//   thirds when the note is dotted: the note starts that much later;
// - after-grace notes (\afterGrace) are played in the last quarter of their
//   note, from LilyPond's 3/4 point. eui-score does not read \afterGrace
//   yet, so only `graceTiming` knows them;
// - several grace notes share the group's time, as written (a group of
//   short ones: a short value each).
//
//   import { applyGraces } from "/eui-score/graces.js";
//   const played = applyGraces(score, bytes, { passes });

const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);
const F = await import(`./feel.js${V}`);

/** The kinds played short, before the beat. */
export const SHORT_KINDS = ["acciaccatura", "grace", "slashedGrace"];
/** A short grace note: at most this many milliseconds… */
export const SHORT_MS = 60;
/** …and at most a 32nd note. */
export const SHORT_NOTE = 32;
/** Where after-grace notes start, into their note: LilyPond's afterGraceFraction. */
export const AFTER_GRACE = 3 / 4;

/**
 * Where a group of grace notes and its note sound, in any one unit of time:
 *
 * - `kind`: "acciaccatura", "grace", "slashedGrace", "appoggiatura" or "afterGrace";
 * - `start`: the note's beat; `value`: the note's length; `dotted`: it is dotted;
 * - `written`: each grace note's written length (the group shares by them);
 * - `short`: a short grace note's length here (a 32nd or 60 ms);
 * - `room`: how much may be taken before the beat (half the note before).
 *
 * Answers { graces: [[on, off]], main, mainEnd, cut }: `main` when the note
 * starts; `mainEnd` when it must end (after-grace), else null; `cut` when
 * the note before must end by (short ones before the beat), else null.
 */
export function graceTiming({ kind, start, value, dotted = false, written, short, room = Infinity }) {
  const n = written.length;
  const share = (from, length, weights) => {
    const total = weights.reduce((sum, w) => sum + w, 0) || n;
    let t = from;
    return weights.map((w) => {
      const span = (length * (w || 1)) / total;
      const out = [t, t + span];
      t += span;
      return out;
    });
  };
  if (kind === "appoggiatura") {
    const length = value * (dotted ? 2 / 3 : 1 / 2);
    return { graces: share(start, length, written), main: start + length, mainEnd: null, cut: null };
  }
  if (kind === "afterGrace") {
    const from = start + value * AFTER_GRACE;
    return { graces: share(from, start + value - from, written), main: start, mainEnd: from, cut: null };
  }
  const even = written.map(() => 1);
  const length = n * short;
  if (length <= room) return { graces: share(start - length, length, even), main: start, mainEnd: null, cut: start - length };
  // Nothing before to take it from: from the note, half of it at most.
  const taken = Math.min(length, value / 2);
  return { graces: share(start, taken, even), main: start + taken, mainEnd: null, cut: null };
}

/** Pass `p`'s ticks a second, as played: its length over its time, the fermatas' holds counted. */
const ticksPerSecond = (score, p) => M.passTicks(score, p) / Math.max(1e-6, p.end - p.start);

/** A short grace note in pass `p`, in the score's ticks: a 32nd, or 60 ms when that is shorter. */
export function shortTicks(score, p) {
  return Math.min(M.WHOLE / SHORT_NOTE, (SHORT_MS / 1000) * ticksPerSecond(score, p));
}

/** The note before note `i` of lane `s`, when it sounds (not a rest): null at the start or after a rest. */
function noteBefore(score, s, i) {
  const ev = score.staves[s].events[i - 1];
  return ev && !ev.rest ? ev : null;
}

/** A pitch's MIDI key: a drum's, or its note's. */
const keyOf = (p) => (p.drum ? M.drumKey(p.drum) : M.midiKey(p.d, p.alter ?? 0));

/** The timing of note `i` of lane `s` (at `t`) in pass `p`, in the score's ticks from its bar's start. */
function timingIn(score, s, i, t, p, room) {
  const ev = score.staves[s].events[i];
  return graceTiming({
    kind: ev.grace ?? "grace",
    start: t,
    value: M.ticksOf(ev),
    dotted: ev.dots > 0,
    written: ev.graces.map((g) => M.notated(g.base, g.dots)),
    short: shortTicks(score, p),
    room,
  });
}

/**
 * When lane `s`'s note `i` (at `t`, ticks) is heard, on each pass through
 * its bar, as Play plays it: after an appoggiatura, on the beat after short
 * grace notes. For lighting the notes; velocity.js matches the engraver's
 * own MIDI with score-model.js `heardAt`.
 */
export function heardAt(score, passes, s, i, t = M.starts(score.staves[s])[i]) {
  const ev = score.staves[s].events[i];
  if (!ev.graces?.length || ev.rest) return M.playedAt(score, passes, t);
  const bar = M.barAt(score, t);
  const before = noteBefore(score, s, i);
  return passes
    .filter((p) => p.bar === bar)
    .map((p) => {
      const timing = timingIn(score, s, i, t, p, before ? M.ticksOf(before) / 2 : t);
      return M.playedAt(score, [p], timing.main)[0];
    });
}

/** Each note with grace notes: [{ s, i, t }]. */
function withGraces(score) {
  const out = [];
  score.staves.forEach((staff, s) => {
    const at = M.starts(staff);
    staff.events.forEach((ev, i) => {
      if (ev.graces?.length && !ev.rest && !(i > 0 && staff.events[i - 1].tie && !staff.events[i - 1].rest)) out.push({ s, i, t: at[i] });
    });
  });
  return out;
}

const isChannel = (data) => data[0] >= 0x80 && data[0] < 0xf0;
const isOn = (data) => (data[0] & 0xf0) === 0x90 && data[2] > 0;
const isOff = (data) => (data[0] & 0xf0) === 0x80 || ((data[0] & 0xf0) === 0x90 && data[2] === 0);

/** A track's notes, each note-on with its note-off: [{ key, on, off }] (events of the track). */
function notesOf(events) {
  const open = new Map();
  const out = [];
  for (const ev of events) {
    if (isOn(ev.data)) {
      const note = { key: ev.data[1], channel: ev.data[0] & 15, on: ev, off: null, used: false };
      const k = `${note.channel}:${note.key}`;
      if (!open.has(k)) open.set(k, []);
      open.get(k).push(note);
      out.push(note);
    } else if (isOff(ev.data)) {
      const note = open.get(`${ev.data[0] & 15}:${ev.data[1]}`)?.shift();
      if (note) note.off = ev;
    }
  }
  return out.filter((note) => note.off);
}

/** Ticks of slack when finding the engraver's notes: its ticks are whole, the model's scaled. */
const SLACK = 2;

/**
 * `bytes` (the MIDI eui-score wrote from `score`, a track a staff, every
 * repeat played out) with its grace notes played as their kind asks. The
 * same bytes when the score has none, or when the file is not what was
 * expected (a note not found is left as eui-score plays it).
 */
export function applyGraces(score, bytes, { passes = null } = {}) {
  if (!score) return bytes;
  const found = withGraces(score);
  if (!found.length) return bytes;
  const played = passes?.length ? passes : M.playback(score);
  const smf = F.readSmf(bytes);
  const tracks = smf.tracks.map((events, k) => k).filter((k) => smf.tracks[k].some((e) => isChannel(e.data)));
  if (tracks.length !== M.staffLanes(score).length) return bytes;
  const ratio = M.WHOLE / 4 / smf.division;
  const starts = [];
  let total = 0;
  for (const p of played) {
    starts.push(total);
    total += M.passTicks(score, p);
  }
  const notes = new Map();
  const notesIn = (k) => {
    if (!notes.has(k)) notes.set(k, notesOf(smf.tracks[k]));
    return notes.get(k);
  };
  let moved = false;
  for (const { s, i, t } of found) {
    const ev = score.staves[s].events[i];
    const list = notesIn(tracks[M.staffNumber(score, s)]);
    const before = noteBefore(score, s, i);
    const bar = M.barAt(score, t);
    const into = t - M.barStart(score, bar);
    played.forEach((p, k) => {
      if (p.bar !== bar) return;
      const held = p.holds.filter((h) => h.at <= into).reduce((sum, h) => sum + h.ticks, 0);
      const beat = starts[k] + into + held;
      // Where eui-score put them: from the beat, as written, half the note at most.
      const written = ev.graces.map((g) => M.notated(g.base, g.dots));
      const sum = written.reduce((a, b) => a + b, 0);
      const take = Math.min(sum, M.ticksOf(ev) / 2);
      const pick = (keys, tick) =>
        keys.map((key) => list.find((n) => !n.used && n.key === key && Math.abs(n.on.tick - tick / ratio) <= SLACK) ?? null);
      let at = beat;
      const graceNotes = ev.graces.map((g, j) => {
        const heads = pick(g.pitches.map(keyOf), at);
        at += (written[j] * take) / sum;
        return heads;
      });
      const mainNotes = pick(ev.pitches.map(keyOf), beat + take);
      if (graceNotes.flat().some((n) => !n) || mainNotes.some((n) => !n)) return;
      for (const n of [...graceNotes.flat(), ...mainNotes]) n.used = true;
      const timing = timingIn(score, s, i, beat, p, before ? M.ticksOf(before) / 2 : beat);
      graceNotes.forEach((heads, j) => {
        for (const n of heads) {
          n.on.tick = timing.graces[j][0] / ratio;
          n.off.tick = Math.max(n.on.tick + 1, timing.graces[j][1] / ratio);
        }
      });
      for (const n of mainNotes) {
        n.on.tick = timing.main / ratio;
        if (timing.mainEnd != null) n.off.tick = timing.mainEnd / ratio;
        n.off.tick = Math.max(n.on.tick + 1, n.off.tick);
      }
      // Short ones before the beat: the note before ends where they start.
      if (timing.cut != null && before) {
        const keys = before.pitches.map(keyOf);
        for (const n of list) {
          if (!keys.includes(n.key) || graceNotes.flat().includes(n)) continue;
          if (n.on.tick < timing.cut / ratio && n.off.tick > timing.cut / ratio && n.off.tick <= beat / ratio + SLACK) n.off.tick = timing.cut / ratio;
        }
      }
      moved = true;
    });
  }
  if (!moved) return bytes;
  F.sortTracks(smf);
  return F.writeSmf(smf);
}
