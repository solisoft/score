// Score following (#390): in practice mode the microphone listens, and the
// place in the score moves on with what is played — no backing music.
//
// The score gives the notes to expect, in the order they are played
// (repeats played out): `[{ keys, bar, ... }]`, a chord one entry whose
// keys any one of answers. Each note heard (pitch.js `noteTracker`) is
// matched against the next ones expected:
//
// - the next note: a match, the place moves on by one;
// - one a little further (up to the end of the next bar): the notes in
//   between were missed, the place jumps to it;
// - none: a wrong note, the place stays. After two wrong notes running,
//   the last notes heard are looked for together — within a bar of the
//   place first, then anywhere — and the place moves there: the player
//   went back, or skipped ahead.
//
// An octave off counts as the note by default: a voice an octave down, a
// flute an octave up, or the detector's octave slip.
//
// No DOM: tests/js/follow.test.mjs runs it on note sequences with errors.

/** Whether `key` (MIDI) answers the expected `note`. */
export function answers(note, key, { octaves = true } = {}) {
  return note.keys.some((k) => k === key || (octaves && ((k - key) % 12 === 0)));
}

/**
 * A follower of `expected` (`[{ keys, bar }]`, in the order played).
 * `hear(key)` answers what it made of a note heard: `{ kind, index, at }` —
 * `kind` "match", "skip" (notes missed before it), "resync" (found
 * elsewhere), "wrong" or "end"; `index` the expected note it answered (or
 * −1); `at` the next note expected now. `at` and `jump(index)` read and
 * set the place.
 */
export function createFollower(expected, { octaves = true, ahead = 8, resyncAfter = 2 } = {}) {
  let at = 0;
  let wrong = 0;
  const heard = [];

  /** The notes `keys` (the last ones heard) found together, ending at an index: the one nearest `near`, within `bars` of it (null: anywhere). */
  function find(keys, near, bars) {
    const bar = expected[Math.min(near, expected.length - 1)]?.bar ?? 0;
    let best = -1;
    for (let j = keys.length - 1; j < expected.length; j++) {
      if (bars != null && Math.abs(expected[j].bar - bar) > bars) continue;
      let ok = true;
      for (let k = 0; k < keys.length && ok; k++) ok = answers(expected[j - (keys.length - 1 - k)], keys[k], { octaves });
      if (ok && (best < 0 || Math.abs(j - near) < Math.abs(best - near))) best = j;
    }
    return best;
  }

  function hear(key) {
    heard.push(key);
    if (heard.length > 4) heard.shift();
    if (at >= expected.length) {
      // Played on past the end: perhaps from the top again.
      const again = heard.length >= 3 ? find(heard.slice(-3), 0, null) : -1;
      if (again >= 0) {
        at = again + 1;
        wrong = 0;
        return { kind: "resync", index: again, at };
      }
      return { kind: "end", index: -1, at };
    }
    // The next notes, as far as the end of the bar after this one.
    const limit = expected[at].bar + 1;
    for (let j = at; j < expected.length && j - at <= ahead && expected[j].bar <= limit; j++) {
      if (answers(expected[j], key, { octaves })) {
        const kind = j === at ? "match" : "skip";
        at = j + 1;
        wrong = 0;
        return { kind, index: j, at };
      }
    }
    wrong++;
    if (wrong >= resyncAfter) {
      // Near first, on the last two heard; then anywhere, on the last three.
      let found = heard.length >= 2 ? find(heard.slice(-2), at, 1) : -1;
      if (found < 0 && heard.length >= 3) found = find(heard.slice(-3), at, null);
      if (found >= 0) {
        at = found + 1;
        wrong = 0;
        return { kind: "resync", index: found, at };
      }
    }
    return { kind: "wrong", index: -1, at };
  }

  return {
    hear,
    get at() {
      return at;
    },
    /** The place set: the next note expected is `index`. */
    jump(index) {
      at = Math.max(0, Math.min(expected.length, index));
      wrong = 0;
      heard.length = 0;
    },
  };
}

/**
 * The notes lane `lane` plays, in order, every repeat played out:
 * `[{ keys, bar, tick, sec }]` — `notes` piano-roll.js `rollNotes`
 * (ticks), `passes` score-model.js `playback`, `barStart(bar)` and
 * `barAt(tick)` the score's, `secOf(pass, ticksIn)` the second of a tick
 * into a pass. A chord is one entry.
 */
export function expectedNotes(notes, lane, passes, { barAt, barStart, secOf }) {
  const byStart = new Map();
  for (const n of notes) {
    if (n.lane !== lane) continue;
    if (!byStart.has(n.t0)) byStart.set(n.t0, []);
    byStart.get(n.t0).push(n.key);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const out = [];
  passes.forEach((pass, p) => {
    const from = barStart(pass.bar);
    const to = barStart(pass.bar + 1);
    for (const t of starts) {
      if (t < from || t >= to || barAt(t) !== pass.bar) continue;
      out.push({ keys: [...new Set(byStart.get(t))].sort((a, b) => a - b), bar: pass.bar, tick: t, pass: p, sec: secOf(pass, t - from) });
    }
  });
  return out;
}
