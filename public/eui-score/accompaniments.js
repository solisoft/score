// The library of accompaniments (#441): styles — Pop, Rock, Bossa, Swing,
// Waltz… — each a pattern for the guitar, the piano, the bass and the
// drums, written from the score's chord symbols in one edit (`arrange`).
//
// A pattern is data, read by one engine. Each line is a bar cut in steps (a
// sixteenth in 4/4: sixteen of them; twelve in 3/4 and 6/8): a step's
// letter starts a note, `-` holds the one before, `.` is silent. What a
// letter plays depends on the instrument, and on the chord sounding then:
//
//   guitar  D strum, every string · U strum up, the top four · B the bass
//           string · A the next string, the alternate bass · b the chord
//           without its bass · 1–6 one string, counted from the lowest
//           played (an arpeggio)
//   piano   left hand (lh): R the bass · F its fifth · O the bass and its
//           octave · L the whole left hand (bass and fifth, or a shell)
//           right hand (rh): C the chord · T its top note · 1–4 one note of
//           it, from the lowest (an arpeggio)
//   bass    R the root · F the fifth · T the third · O the root an octave
//           up · A a note leading a semitone into the next chord's root
//   drums   a groove of drums.js: a line a drum (M.DRUMS's names), x where
//           it is struck
//
// The voicings — the guitar's shape, the piano's hands led from chord to
// chord, the bass in its range — are voicings.js's. No DOM here:
// tests/js/accompaniments.test.mjs calls these on scores the engraver read.

const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);
const Voice = await import(`./voicings.js${V}`);
const D = await import(`./drums.js${V}`);

/** The instruments a style writes for, in the order their staves are added. */
export const PARTS = ["guitar", "piano", "bass", "drums"];
export const PART_NAMES = { guitar: "Guitar", piano: "Piano", bass: "Bass", drums: "Drums" };

/**
 * The styles: { id, name, group, time, bpm, swing, sounds, piano (its
 * voicing: "open" or "shell"), guitar, piano: { lh, rh }, bass, groove } —
 * `groove` the drums', from drums.js: its basic bar, and its break every
 * fourth bar.
 * `time` is the metre the patterns are written in; `sounds` the General
 * MIDI sounds of the staves it adds.
 */
export const STYLES = [
  {
    id: "pop", name: "Pop", group: "Pop and rock", time: "4/4", bpm: 100,
    guitar: "D---D-U---U-D-U-", piano: { lh: "R-------R-------", rh: "C---C---C---C---" },
    bass: "R-----R-R---F---", groove: "pop",
  },
  {
    id: "rock", name: "Rock", group: "Pop and rock", time: "4/4", bpm: 120, sounds: { guitar: "electric guitar (clean)" },
    guitar: "D-D-D-D-D-D-D-D-", piano: { lh: "O-------O-------", rh: "C-C-C-C-C-C-C-C-" },
    bass: "R-R-R-R-R-R-R-R-", groove: "rock-push",
  },
  {
    id: "pop-ballad", name: "Pop ballad", group: "Pop and rock", time: "4/4", bpm: 72,
    guitar: "D-------D---U---", piano: { lh: "L---------------", rh: "1-2-3-2-1-2-3-2-" },
    bass: "R-------R-----F-", groove: "power-ballad",
  },
  {
    id: "arpeggio-ballad", name: "Arpeggio ballad", group: "Pop and rock", time: "4/4", bpm: 66, sounds: { guitar: "acoustic guitar (nylon)" },
    guitar: "1-3-4-5-6-5-4-3-", piano: { lh: "R---------------", rh: "1-2-3-4-3-2-1-2-" },
    bass: "R---------------", groove: "brushes",
  },
  {
    id: "folk", name: "Folk", group: "Pop and rock", time: "4/4", bpm: 100,
    guitar: "B---D-U-A---D-U-", piano: { lh: "R-------F-------", rh: "----C-C-----C-C-" },
    bass: "R---F---R---F---", groove: "rock",
  },
  {
    id: "country", name: "Country", group: "Pop and rock", time: "4/4", bpm: 112,
    guitar: "B---b---A---b---", piano: { lh: "R-------F-------", rh: "----C-------C---" },
    bass: "R-------F-----A-", groove: "train",
  },
  {
    id: "bossa", name: "Bossa nova", group: "Latin", time: "4/4", bpm: 130, sounds: { guitar: "acoustic guitar (nylon)", bass: "acoustic bass" },
    guitar: "B--b--b-A-b--b--", piano: { lh: "R-------F-------", rh: "C--C--C---C--C--" },
    bass: "R-----F-R-----F-", groove: "bossa",
  },
  {
    id: "samba", name: "Samba", group: "Latin", time: "4/4", bpm: 100, sounds: { guitar: "acoustic guitar (nylon)" },
    guitar: "D-b-bD-b-D-b-bD-", piano: { lh: "R---F---R---F---", rh: "-C-C-C--C-C-C-C-" },
    bass: "R--FR---R--FR---", groove: "samba",
  },
  {
    id: "reggae", name: "Reggae", group: "Latin", time: "4/4", bpm: 76, sounds: { guitar: "electric guitar (clean)" },
    guitar: "----U-------U---", piano: { lh: "................", rh: "--C---C---C---C-" },
    bass: "R-----R-F---R---", groove: "one-drop",
  },
  {
    id: "swing", name: "Swing", group: "Jazz", time: "4/4", bpm: 140, swing: 66, piano: "shell", sounds: { guitar: "electric guitar (jazz)", bass: "acoustic bass" },
    guitar: "D---D---D---D---", piano: { lh: "L---------------", rh: "----C-----C-----" },
    bass: "R---T---F---A---", groove: "swing",
  },
  {
    id: "jazz-ballad", name: "Jazz ballad", group: "Jazz", time: "4/4", bpm: 64, swing: 66, piano: "shell", sounds: { guitar: "electric guitar (jazz)", bass: "acoustic bass" },
    guitar: "D---------------", piano: { lh: "L---------------", rh: "C-------C-------" },
    bass: "R-------F---A---", groove: "brushes",
  },
  {
    id: "shuffle", name: "Shuffle blues", group: "Jazz", time: "4/4", bpm: 100, swing: 67, sounds: { guitar: "electric guitar (clean)" },
    guitar: "B-b-B-b-B-b-B-b-", piano: { lh: "O-O-O-O-O-O-O-O-", rh: "--C---C---C---C-" },
    bass: "R-T-F-T-R-T-F-T-", groove: "shuffle",
  },
  {
    id: "funk", name: "Funk", group: "Groove", time: "4/4", bpm: 100, sounds: { guitar: "electric guitar (clean)", bass: "slap bass 1" },
    guitar: "D-U-DUD-U-UDU-D-", piano: { lh: "R--R---R-R--R---", rh: "C--C--C-C--C--C-" },
    bass: "R--RR-O-R--F-R-O", groove: "funk",
  },
  {
    id: "waltz", name: "Waltz", group: "In three", time: "3/4", bpm: 140,
    guitar: "B---b---b---", piano: { lh: "R-----------", rh: "----C---C---" },
    bass: "R-----------", groove: "waltz",
  },
  {
    id: "six-eight", name: "6/8 ballad", group: "In three", time: "6/8", bpm: 60, sounds: { guitar: "acoustic guitar (nylon)" },
    guitar: "1-3-4-5-4-3-", piano: { lh: "R-----F-----", rh: "--1-2-3-2-1-" },
    bass: "R-----F-----", groove: "ballad-68",
  },
];

const DEFAULT_SOUNDS = { guitar: "acoustic guitar (steel)", piano: "acoustic grand", bass: "electric bass (finger)" };

export function styleOf(id) {
  return STYLES.find((s) => s.id === id) ?? null;
}

/** The style a bar in metre `time` ("3/4") is played in when the style is written in another: one note a beat. */
function fallback(time) {
  const [num, den] = time.split("/").map(Number);
  const compound = den === 8 && num % 3 === 0 && num > 3;
  const beats = compound ? num / 3 : num;
  const per = 4;
  const beat = (first, other) => Array.from({ length: beats }, (_, k) => (k === 0 ? first : other) + "-".repeat(per - 1)).join("");
  return {
    steps: beats * per,
    guitar: beat("D", "D"),
    piano: { lh: beat("R", "-"), rh: beat("C", "C") },
    bass: beat("R", "-"),
    drums: { bd: beat("x", "-"), hh: beat("x", "x") },
  };
}

/** A pattern line as notes: [{ at, len, symbol }], `at` and `len` in steps. */
export function notesOf(line) {
  const out = [];
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (c === "-" || c === ".") continue;
    let end = k + 1;
    while (end < line.length && line[end] === "-") end++;
    out.push({ at: k, len: end - k, symbol: c });
  }
  return out;
}

/** The drums of a bar: [{ at, len, drums }], the drums struck together, each held to the next stroke. */
export function hitsOf(lines) {
  const steps = Math.max(...Object.values(lines).map((l) => l.length));
  const onsets = [];
  for (let k = 0; k < steps; k++) {
    const drums = Object.entries(lines).filter(([, l]) => l[k] === "x" || l[k] === "X").map(([name]) => name);
    if (drums.length) onsets.push({ at: k, drums });
  }
  return onsets.map((hit, n) => ({ ...hit, len: (onsets[n + 1]?.at ?? steps) - hit.at }));
}

// ---- What each letter plays --------------------------------------------------------

const octaveUp = (p) => ({ d: p.d + 7, alter: p.alter });

function guitarNotes(chord, symbol) {
  const notes = Voice.guitarPitches(chord);
  if (!notes.length) return [];
  if (symbol === "D") return notes;
  if (symbol === "U") return notes.slice(-4);
  if (symbol === "B") return [notes[0]];
  if (symbol === "A") return [notes.length > 3 ? notes[1] : notes[0]];
  if (symbol === "b") return notes.length > 1 ? notes.slice(1) : notes;
  if (/[1-6]/.test(symbol)) return [notes[(Number(symbol) - 1) % notes.length]];
  return [];
}

function lhNotes(voicing, symbol) {
  const lh = voicing.lh;
  if (symbol === "R") return [lh[0]];
  if (symbol === "F") return [lh[1] ?? lh[0]];
  if (symbol === "O") return [lh[0], octaveUp(lh[0])];
  if (symbol === "L") return lh;
  return [];
}

function rhNotes(voicing, symbol) {
  const rh = voicing.rh;
  if (symbol === "C") return rh;
  if (symbol === "T") return rh.slice(-1);
  if (/[1-6]/.test(symbol)) return [rh[(Number(symbol) - 1) % rh.length]];
  return [];
}

function bassNote(chord, next, symbol, previous) {
  if (symbol === "A") return next ? Voice.approachNote(next, previous) : Voice.bassNote(chord, "fifth", previous);
  const role = { R: "root", F: "fifth", T: "third", O: "octave" }[symbol];
  return role ? Voice.bassNote(chord, role, previous) : null;
}

// ---- The staves --------------------------------------------------------------------

/** The lanes `part` is written on: an existing staff named for it, or a new one (two for the piano). */
function lanesFor(score, part, style, added) {
  const lanes = M.staffLanes(score);
  if (part === "piano") {
    const group = (score.groups ?? []).find((g) => g.kind === "brace" && g.name === "Piano");
    if (group && lanes[group.first] != null && lanes[group.last] != null) return [lanes[group.first], lanes[group.last]];
    const sound = style.sounds?.piano ?? DEFAULT_SOUNDS.piano;
    M.addStaff(score, { instrument: sound, name: "", short: "", clef: "treble" });
    M.addStaff(score, { instrument: sound, name: "", short: "", clef: "bass" });
    const now = M.staffLanes(score);
    const first = now.length - 2;
    score.groups = [...(score.groups ?? []), { kind: "brace", first, last: first + 1, name: "Piano", short: "Pno." }];
    added.push("Piano");
    return [now[first], now[first + 1]];
  }
  const name = PART_NAMES[part];
  const found = lanes.find((s) => score.staves[s].name === name);
  if (found != null) return [found];
  if (part === "drums") M.addStaff(score, { instrument: "", name, short: "Dr.", clef: "percussion", drums: true });
  else {
    const clef = part === "guitar" ? "treble_8" : "bass_8";
    M.addStaff(score, { instrument: style.sounds?.[part] ?? DEFAULT_SOUNDS[part], name, short: part === "guitar" ? "Gtr." : "Bass", clef });
  }
  added.push(name);
  const now = M.staffLanes(score);
  return [now[now.length - 1]];
}

// ---- Writing -------------------------------------------------------------------------

/**
 * Style `styleId` written from the chord symbols over bars `a` to `b` (all
 * by default) for `parts` — guitar, piano, bass, drums — each on its staff,
 * added when the score has none (a staff named Guitar, Bass or Drums, a
 * brace named Piano), over what those staves held there. `diagrams` puts a
 * guitar diagram over each chord; `feel` the style's swing on the score;
 * `breaks` a drum break at the end of each four bars, and of the last.
 * Answers { added, chords, bars }; throws with nothing changed when there is
 * no chord symbol to play.
 */
export function arrange(score, styleId, { a = 0, b = null, parts = PARTS, diagrams = true, feel = true, breaks = true } = {}) {
  const style = styleOf(styleId);
  if (!style) throw new Error(`no style called ${styleId}`);
  const last = b ?? M.barsOf(score) - 1;
  if (a < 0 || last >= M.barsOf(score) || a > last) throw new Error("no such bars");
  const t0 = M.barStart(score, a);
  const t1 = M.barStart(score, last + 1);
  const all = Voice.chordSymbols(score);
  const before = all.filter((c) => c.t < t0).at(-1);
  const inside = all.filter((c) => c.t >= t0 && c.t < t1);
  const chords = before && !inside.some((c) => c.t === t0) ? [{ ...before, t: t0 }, ...inside] : inside;
  if (!chords.length) throw new Error("No chord symbols there: add some with Insert ▸ Chord symbol (Ctrl+K), or ask the AI to suggest chords");
  const wanted = PARTS.filter((p) => parts.includes(p));
  if (!wanted.length) throw new Error("Choose an instrument to write for");
  const added = [];
  const lanesOf = Object.fromEntries(wanted.map((p) => [p, lanesFor(score, p, style, added)]));
  for (const lanes of Object.values(lanesOf)) for (const s of lanes) M.write(score, s, t0, t1 - t0, { rest: true });
  const chordAt = (t) => chords.filter((c) => c.t <= t).at(-1)?.text ?? null;
  const nextAfter = (t) => all.find((c) => c.t > t)?.text ?? null;
  // Where a held note meets a new chord, it is played again on the new chord.
  const cuts = (from, to) => [from, ...chords.map((c) => c.t).filter((t) => t > from && t < to), to];

  /** Each note of `line` in bar `bar`, cut where the chord changes: [{ t, len, chord, symbol }]. */
  function placed(line, bar, steps) {
    const start = M.barStart(score, bar);
    const step = (M.barStart(score, bar + 1) - start) / steps;
    const out = [];
    for (const note of notesOf(line)) {
      const points = cuts(start + note.at * step, start + (note.at + note.len) * step);
      for (let k = 0; k < points.length - 1; k++) out.push({ t: points[k], len: points[k + 1] - points[k], chord: chordAt(points[k]), symbol: note.symbol });
    }
    return out.filter((n) => n.chord);
  }

  /** The bar's pattern for `part`: the style's when it is written in the bar's metre and divides it, else a note a beat. */
  function patternOf(part, bar) {
    const time = M.timeAt(score, bar).join("/");
    const length = M.barStart(score, bar + 1) - M.barStart(score, bar);
    const groove = D.grooveOf(style.groove);
    // A phrase is four bars: its last one, and the last bar written, are the groove's break.
    const breaking = breaks && ((bar - a) % 4 === 3 || (bar === last && bar > a));
    const own = part === "drums" ? (breaking ? D.breakOf(groove) : groove.main) : style[part];
    const steps = part === "drums" ? Math.max(...Object.values(own).map((l) => l.length)) : (part === "piano" ? own.lh : own).length;
    if (time === style.time && Number.isInteger(length / steps)) return { line: own, steps };
    const plain = fallback(time);
    return { line: plain[part], steps: plain.steps };
  }

  const write = (s, t, len, pitches) => {
    if (len <= 0 || !pitches.length) return;
    M.write(score, s, t, len, { rest: false, pitches: pitches.map((p) => ({ ...p })) });
  };
  let pianoVoicing = null;
  let pianoChord = null;
  let bassPrevious = null;
  for (let bar = a; bar <= last; bar++) {
    for (const part of wanted) {
      const [lane, lower] = lanesOf[part];
      const { line, steps } = patternOf(part, bar);
      if (part === "drums") {
        const start = M.barStart(score, bar);
        const step = (M.barStart(score, bar + 1) - start) / steps;
        for (const hit of hitsOf(line)) write(lane, start + hit.at * step, hit.len * step, hit.drums.map((name) => M.drumPitch(name)));
      } else if (part === "guitar") {
        for (const n of placed(line, bar, steps)) write(lane, n.t, n.len, guitarNotes(n.chord, n.symbol));
      } else if (part === "bass") {
        for (const n of placed(line, bar, steps)) {
          const note = bassNote(n.chord, nextAfter(n.t), n.symbol, bassPrevious);
          if (!note) continue;
          write(lane, n.t, n.len, [note]);
          bassPrevious = note;
        }
      } else {
        const voiced = (chord) => {
          if (chord !== pianoChord) {
            pianoVoicing = Voice.pianoVoicing(chord, pianoVoicing, { style: style.piano === "shell" ? "shell" : "open" });
            pianoChord = chord;
          }
          return pianoVoicing;
        };
        for (const n of placed(line.rh, bar, steps)) write(lane, n.t, n.len, rhNotes(voiced(n.chord), n.symbol));
        for (const n of placed(line.lh, bar, steps)) write(lower, n.t, n.len, lhNotes(voiced(n.chord), n.symbol));
      }
    }
  }
  if (diagrams && lanesOf.guitar) {
    try {
      Voice.diagramsFromSymbols(score, lanesOf.guitar[0], { a, b: last });
    } catch (error) {
      // No chord with a note under it on the guitar's staff: no diagram.
    }
  }
  if (feel && style.swing) score.meta = { ...(score.meta ?? {}), swing: { amount: style.swing, unit: 8 } };
  return { added, chords: chords.length, bars: last - a + 1 };
}
