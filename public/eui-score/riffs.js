// Guitar riffs (#458): lines of single notes and power chords that follow
// the chords sounding, low on the neck — a blues boogie, a rock drive, a
// funk line, surf picking, a metal gallop, a country walk. A riff is data,
// as the accompaniments' patterns and the drums' grooves are: a line a bar,
// a step a letter — a sixteenth in 4/4 (sixteen steps) and in 3/4 (twelve),
// an eighth in 6/8 (six) and 12/8 (twelve) — read against the chord of its
// moment by `riffNotes`:
//
//   R the root · F the fifth · T the chord's third · Q the fourth · S the
//   sixth · Z the flat seventh · O the root an octave up · P a power chord
//   (root and fifth) · Y the root and the sixth · W the root and the flat
//   seventh (a boogie's two shapes) · - the note before held · . a rest
//
// No DOM here: tests/js/riffs.test.mjs reads them, and accompaniments.js
// writes them.

const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);
const Voice = await import(`./voicings.js${V}`);

/** The riffs: { id, name, group, time, bpm, swing, bars: [a line a bar] }. */
export const RIFFS = [
  // ---- Blues and rock'n'roll
  { id: "boogie", name: "Blues boogie", group: "Blues and rock'n'roll", time: "4/4", bpm: 120, swing: 67, bars: ["P-P-Y-Y-P-P-Y-Y-", "P-P-Y-Y-W-W-Y-Y-"] },
  { id: "boogie-walk", name: "Boogie walk-up", group: "Blues and rock'n'roll", time: "4/4", bpm: 120, swing: 67, bars: ["R-T-F-S-Z-S-F-T-"] },
  { id: "slow-blues", name: "Slow blues line", group: "Blues and rock'n'roll", time: "12/8", bpm: 60, bars: ["R--F--S--F--", "R--F--Z--S--"] },
  { id: "rocknroll", name: "Rock'n'roll eighths", group: "Blues and rock'n'roll", time: "4/4", bpm: 160, bars: ["R-R-T-T-F-F-S-S-", "Z-Z-S-S-F-F-T-T-"] },

  // ---- Rock and metal
  { id: "drive", name: "Rock drive, power chords", group: "Rock and metal", time: "4/4", bpm: 130, bars: ["P-P-P-P-P-P-P-P-"] },
  { id: "rock-riff", name: "Rock riff", group: "Rock and metal", time: "4/4", bpm: 110, bars: ["R-R-Z-R-.-R-Q-F-", "R-R-Z-R-O---Z---"] },
  { id: "punk", name: "Punk downstrokes", group: "Rock and metal", time: "4/4", bpm: 180, bars: ["PPPPPPPPPPPPPPPP"] },
  { id: "gallop", name: "Metal gallop", group: "Rock and metal", time: "4/4", bpm: 150, bars: ["P-PPP-PPP-PPP-PP"] },
  { id: "chug", name: "Palm-muted chug", group: "Rock and metal", time: "4/4", bpm: 100, bars: ["P.P.P.PPP.P.P.PP", "P.P.P.PPO---Z---"] },
  { id: "stoner", name: "Heavy, held", group: "Rock and metal", time: "4/4", bpm: 80, bars: ["P-------R-Z-F-Q-"] },

  // ---- Funk and soul
  { id: "funk-line", name: "Funk single-note", group: "Funk and soul", time: "4/4", bpm: 100, bars: ["R.RO.R.ZR.O.R.Z.", "R.RO.R.ZF.Z.O.Z."] },
  { id: "soul-line", name: "Soul line", group: "Funk and soul", time: "4/4", bpm: 96, bars: ["R-.FS.F-R-.FS.F-"] },
  { id: "disco-octaves", name: "Disco octaves", group: "Funk and soul", time: "4/4", bpm: 120, bars: ["R.O.R.O.R.O.R.O."] },

  // ---- Surf, country and pop
  { id: "surf", name: "Surf tremolo", group: "Surf, country and pop", time: "4/4", bpm: 150, bars: ["RRRROOOOZZZZFFFF"] },
  { id: "country-walk", name: "Country bass and chicken pickin'", group: "Surf, country and pop", time: "4/4", bpm: 120, bars: ["R-O-F-O-R-O-F-O-"] },
  { id: "pop-pick", name: "Pop picking", group: "Surf, country and pop", time: "4/4", bpm: 100, bars: ["R-F-O-F-T-F-O-F-"] },
  { id: "ballad-68", name: "6/8 picking", group: "Surf, country and pop", time: "6/8", bpm: 60, bars: ["RFOFTF"] },
  { id: "waltz-34", name: "Waltz, bass and chords", group: "Surf, country and pop", time: "3/4", bpm: 120, bars: ["R---P---P---"] },
];

/** The riff of id `id`, or null. */
export function riffOf(id) {
  return RIFFS.find((riff) => riff.id === id) ?? null;
}

/** A riff's steps in a bar: the length of its lines. */
export function stepsOf(riff) {
  return riff.bars[0].length;
}

const mod12 = (n) => ((n % 12) + 12) % 12;
// The root low on the neck: from the low E (40) to the D♯ above it.
const LOW = 40;
// What each letter plays above the root: [steps, semitones] a note; T is the chord's own third.
const NOTES = {
  R: [[0, 0]], F: [[4, 7]], Q: [[3, 5]], S: [[5, 9]], Z: [[6, 10]], O: [[7, 12]],
  P: [[0, 0], [4, 7]], Y: [[0, 0], [5, 9]], W: [[0, 0], [6, 10]],
};

/** A pitch spelt like `like` ({ d, alter }) at MIDI key `key`. */
function atKey(like, key) {
  const octave = Math.round((key - M.midiKey(like.d, like.alter)) / 12);
  return { d: like.d + 7 * octave, alter: like.alter };
}

/**
 * The notes letter `symbol` plays over chord `text` (a chord symbol): its
 * root low on the neck, the other notes counted from it and spelt from it.
 * [] for a chord this cannot read, or a letter that plays nothing.
 */
export function riffNotes(text, symbol) {
  const chord = Voice.chordTones(text);
  if (!chord) return [];
  let notes = NOTES[symbol];
  if (symbol === "T") notes = [chord.tones.find(([steps]) => steps === 2) ?? [2, 4]];
  if (!notes) return [];
  const root = { d: chord.root.step, alter: chord.root.alter };
  const low = LOW + mod12(M.midiKey(root.d, root.alter) - LOW);
  return notes.map(([steps, semitones]) => atKey(M.transposePitch(root, steps, semitones), low + semitones));
}

// ---- Piano patterns (#459) ---------------------------------------------------------

/**
 * Piano patterns that follow the chords: { id, name, group, time, bpm,
 * swing, bars: [{ lh, rh }] }. The left hand reads a riff's letters
 * (riffNotes: R F T Q S Z O P Y W, low on the keyboard) or L, the chord's
 * left hand as voiced; the right hand the accompaniments' (C the chord, T
 * its top note, 1–6 one of its notes, low to high).
 */
export const PIANO_RIFFS = [
  { id: "boogie-woogie", name: "Boogie-woogie", group: "Blues and rock'n'roll", time: "4/4", bpm: 120, swing: 67, bars: [{ lh: "R-T-F-S-Z-S-F-T-", rh: "--C--C-C--C--C-C" }] },
  { id: "boogie-shapes", name: "Boogie, left-hand shapes", group: "Blues and rock'n'roll", time: "4/4", bpm: 120, swing: 67, bars: [{ lh: "P-P-Y-Y-P-P-Y-Y-", rh: "C-------C---C---" }, { lh: "P-P-Y-Y-W-W-Y-Y-", rh: "C-------C---C---" }] },
  { id: "triplets", name: "Rock'n'roll triplets", group: "Blues and rock'n'roll", time: "12/8", bpm: 70, bars: [{ lh: "R--F--S--F--", rh: "CCCCCCCCCCCC" }] },
  { id: "stride", name: "Stride", group: "Jazz and gospel", time: "4/4", bpm: 160, swing: 62, bars: [{ lh: "R---L---F---L---", rh: "C-------C---C---" }] },
  { id: "gospel", name: "Gospel", group: "Jazz and gospel", time: "4/4", bpm: 80, swing: 60, bars: [{ lh: "R-------R---F---", rh: "C--C--C-C--C--CT" }] },
  { id: "jazz-comp", name: "Jazz comping", group: "Jazz and gospel", time: "4/4", bpm: 140, swing: 66, bars: [{ lh: "L---------------", rh: "------C-----C---" }, { lh: "L---------------", rh: "--C-------C-----" }] },
  { id: "alberti", name: "Alberti bass", group: "Classical and ballad", time: "4/4", bpm: 100, bars: [{ lh: "R-F-T-F-R-F-T-F-", rh: "C---------------" }] },
  { id: "ballad-arp", name: "Ballad arpeggios", group: "Classical and ballad", time: "4/4", bpm: 70, bars: [{ lh: "R---F---O-------", rh: "1-2-3-4-3-2-1-2-" }] },
  { id: "waltz-piano", name: "Waltz, oom-pah-pah", group: "Classical and ballad", time: "3/4", bpm: 120, bars: [{ lh: "R-----------", rh: "----C---C---" }, { lh: "F-----------", rh: "----C---C---" }] },
  { id: "ballad-68", name: "6/8 broken chords", group: "Classical and ballad", time: "6/8", bpm: 60, bars: [{ lh: "R-----", rh: "-1-2-3" }] },
  { id: "pop-eighths", name: "Pop eighths", group: "Pop, funk and dance", time: "4/4", bpm: 110, bars: [{ lh: "R-------R---F---", rh: "C-C-C-C-C-C-C-C-" }] },
  { id: "funk-clav", name: "Funk clavinet", group: "Pop, funk and dance", time: "4/4", bpm: 100, bars: [{ lh: "R..R..R...R.....", rh: "C.CC.C.CC.C.C.CC" }] },
  { id: "house-stabs", name: "House stabs", group: "Pop, funk and dance", time: "4/4", bpm: 124, bars: [{ lh: "R-------R-------", rh: "--C--C----C--C--" }] },
  { id: "montuno", name: "Montuno", group: "Latin", time: "4/4", bpm: 180, bars: [{ lh: "R--F---R--F----.", rh: "C-1-3-C-1-C-3-1-" }] },
  { id: "reggae-bubble", name: "Reggae bubble", group: "Latin", time: "4/4", bpm: 76, bars: [{ lh: "R-------.-----R-", rh: "--C---C---C---C-" }] },
];

/** The piano pattern of id `id`, or null. */
export function pianoRiffOf(id) {
  return PIANO_RIFFS.find((riff) => riff.id === id) ?? null;
}
