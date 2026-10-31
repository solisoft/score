// The drum grooves (#442): a basic bar and a break for each, from rock to
// reggaeton, from a jazz waltz to a 12/8 gospel. A groove is data, as the
// accompaniments' patterns are (accompaniments.js): a line a drum, a step a
// letter — a sixteenth in 4/4 (sixteen steps), and in 3/4 and 6/8 (twelve);
// an eighth in 12/8 (twelve) — x where the drum is struck, X accented, g a
// ghost note (barely touched: the funk snare between the backbeats).
//
// The drums are M.DRUMS's: bd kick, sn snare, ss side stick, hh hi-hat,
// hho open hi-hat, hhp pedal hi-hat, cymc crash, cymr ride, rb ride bell,
// tomh / tommh / tomml / toml / tomfh / tomfl the toms, hc clap, cb cowbell,
// tamb tambourine.

/** The breaks the grooves share, by the steps of their bar. */
const BREAKS = {
  16: {
    toms: { hh: "x-x-x-x---------", bd: "x-------x-------", sn: "----x---xx------", tomh: "----------xx----", tommh: "------------xx--", tomfh: "--------------xx" },
    snare: { hh: "x-x-x-x---------", bd: "x-------x-------", sn: "----x---xxxxxxxx" },
    stop: { cymc: "x---------------", bd: "x---------------", sn: "------------x-xx" },
    pickup: { hh: "x-x-x-x-x-x-x---", bd: "x-------x-x-----", sn: "----x-------x-xx" },
    swing: { cymr: "x---x-x-x-------", hhp: "----x-----------", sn: "--------x--x-xx-", bd: "x-----------x---" },
    latin: { cb: "x---x---x-------", bd: "x--x----x-------", tomh: "--------x-x-x---", tomfh: "-------------xxx" },
    rolls: { hh: "x-x-x-x-x-x-----", bd: "x-x-x-x-x-x-x-x-", sn: "----x-------xxxx" },
    electro: { bd: "x---x---x---x---", hc: "----x-------x---", sn: "--------xxxxxxxx" },
  },
  12: {
    toms: { hh: "x-x-x-------", bd: "x-----------", sn: "------xxx---", tomh: "---------x--", tomfh: "----------xx" },
    snare: { hh: "x-x-x-------", bd: "x-----------", sn: "------xxxxxx" },
    stop: { cymc: "x-----------", bd: "x-----------", sn: "---------xxx" },
  },
};

/**
 * The grooves: { id, name, group, time, bpm, swing (when the eighths are
 * swung), main, fill } — `main` the basic bar, `fill` its break: a name of
 * BREAKS or lines of its own.
 */
export const GROOVES = [
  // ---- Rock and pop
  { id: "rock", name: "Rock beat", group: "Rock and pop", time: "4/4", bpm: 110, main: { hh: "x-x-x-x-x-x-x-x-", sn: "----x-------x---", bd: "x-------x-------" }, fill: "toms" },
  { id: "rock-push", name: "Rock, pushed kick", group: "Rock and pop", time: "4/4", bpm: 120, main: { hh: "x-x-x-x-x-x-x-x-", sn: "----x-------x---", bd: "x-----x-x-------" }, fill: "toms" },
  { id: "rock-16", name: "Rock, sixteenths", group: "Rock and pop", time: "4/4", bpm: 96, main: { hh: "xxxxxxxxxxxxxxxx", sn: "----x--g----x--g", bd: "x-----x---x-----" }, fill: "snare" },
  { id: "hard-rock", name: "Hard rock on the ride", group: "Rock and pop", time: "4/4", bpm: 128, main: { rb: "x-x-x-x-x-x-x-x-", sn: "----x-------x---", bd: "x-x-----x-x-----" }, fill: "toms" },
  { id: "pop", name: "Pop", group: "Rock and pop", time: "4/4", bpm: 100, main: { hh: "x-x-x-x-x-x-x-x-", sn: "----x-------x---", bd: "x-------x-x-----" }, fill: "pickup" },
  { id: "pop-halftime", name: "Pop, half time", group: "Rock and pop", time: "4/4", bpm: 140, main: { hh: "x-x-x-x-x-x-x-x-", sn: "--------x-------", bd: "x-----x---x-----" }, fill: "snare" },
  { id: "power-ballad", name: "Power ballad", group: "Rock and pop", time: "4/4", bpm: 70, main: { hh: "x---x---x---x---", sn: "----x-------x---", bd: "x-----x-x-------" }, fill: "toms" },
  { id: "motown", name: "Motown", group: "Rock and pop", time: "4/4", bpm: 120, main: { hh: "x-x-x-x-x-x-x-x-", sn: "x---x---x---x---", tamb: "----x-------x---", bd: "x-------x-x-----" }, fill: "pickup" },
  { id: "punk", name: "Punk", group: "Rock and pop", time: "4/4", bpm: 180, main: { hh: "x-x-x-x-x-x-x-x-", sn: "--x---x---x---x-", bd: "x---x---x---x---" }, fill: "rolls" },
  { id: "train", name: "Train beat (country)", group: "Rock and pop", time: "4/4", bpm: 160, main: { sn: "xxxxxxxxxxxxxxxx", bd: "x-------x-------" }, fill: "stop" },
  { id: "tom-groove", name: "Tom groove", group: "Rock and pop", time: "4/4", bpm: 100, main: { tomfh: "x--x--x---x--x--", sn: "----x-------x---", bd: "x-------x-------" }, fill: "toms" },
  { id: "indie", name: "Indie, busy kick", group: "Rock and pop", time: "4/4", bpm: 124, main: { hh: "x-x-x-x-x-x-x-x-", sn: "----x-------x---", bd: "x--x--x---x--x--" }, fill: "snare" },
  { id: "metal", name: "Metal, double kick", group: "Rock and pop", time: "4/4", bpm: 140, main: { cymr: "x---x---x---x---", sn: "----x-------x---", bd: "xxxxxxxxxxxxxxxx" }, fill: "rolls" },

  // ---- Funk, soul and hip-hop
  { id: "funk", name: "Funk", group: "Funk and soul", time: "4/4", bpm: 100, main: { hh: "x-xxx-xxx-xxx-xx", sn: "----x--g-g--x---", bd: "x--x--x---x-----" }, fill: "snare" },
  { id: "funk-16", name: "Funk, sixteenths", group: "Funk and soul", time: "4/4", bpm: 96, main: { hh: "xxxxxxxxxxxxxxxx", sn: "----x--g-g--x--g", bd: "x-x---x---x-x---" }, fill: "pickup" },
  { id: "linear", name: "Linear funk", group: "Funk and soul", time: "4/4", bpm: 92, main: { hh: "-x-x--x-x-x--x-x", sn: "---gx--g---gx---", bd: "x-x--x---x---x--" }, fill: "toms" },
  { id: "purdie", name: "Half-time shuffle", group: "Funk and soul", time: "4/4", bpm: 84, swing: 67, main: { hh: "x-x-x-x-x-x-x-x-", sn: "-g-g-g-gxg-g-g-g", bd: "x-----x---x-----" }, fill: "swing" },
  { id: "soul", name: "Soul", group: "Funk and soul", time: "4/4", bpm: 96, main: { hh: "x-x-x-x-x-x-x-x-", sn: "----x------gx---", bd: "x------xx-------" }, fill: "pickup" },
  { id: "rnb", name: "R&B, slow", group: "Funk and soul", time: "4/4", bpm: 70, main: { hh: "x-xxx-x-x-xxx-x-", sn: "----x--g----x-g-", bd: "x--x------x-----" }, fill: "snare" },
  { id: "neo-soul", name: "Neo-soul", group: "Funk and soul", time: "4/4", bpm: 80, swing: 58, main: { hh: "x-x-x-x-x-x-x-x-", ss: "----x-------x---", bd: "x-------xx-x----" }, fill: "swing" },
  { id: "disco", name: "Disco", group: "Funk and soul", time: "4/4", bpm: 120, main: { hh: "x---x---x---x---", hho: "--x---x---x---x-", sn: "----x-------x---", bd: "x---x---x---x---" }, fill: "pickup" },
  { id: "boom-bap", name: "Hip-hop, boom bap", group: "Funk and soul", time: "4/4", bpm: 90, swing: 58, main: { hh: "x-x-x-x-x-x-x-x-", sn: "----x-------x---", bd: "x------x--x-----" }, fill: "stop" },
  { id: "trap", name: "Trap", group: "Funk and soul", time: "4/4", bpm: 140, main: { hh: "x-x-x-xxx-x-x-xx", hc: "--------x-------", bd: "x------x--x-----" }, fill: "electro" },

  // ---- Electronic
  { id: "house", name: "House", group: "Electronic", time: "4/4", bpm: 124, main: { hho: "--x---x---x---x-", hc: "----x-------x---", bd: "x---x---x---x---" }, fill: "electro" },
  { id: "techno", name: "Techno", group: "Electronic", time: "4/4", bpm: 130, main: { hh: "xxxxxxxxxxxxxxxx", hc: "----x-------x---", bd: "x---x---x---x---" }, fill: "electro" },
  { id: "breakbeat", name: "Breakbeat", group: "Electronic", time: "4/4", bpm: 170, main: { hh: "x-x-x-x-x-x-x-x-", sn: "----x--x-x--x---", bd: "x-x-------x-----" }, fill: "snare" },
  { id: "reggaeton", name: "Reggaeton (dembow)", group: "Electronic", time: "4/4", bpm: 96, main: { hh: "x-x-x-x-x-x-x-x-", sn: "---x--x----x--x-", bd: "x---x---x---x---" }, fill: "electro" },

  // ---- Latin and Caribbean
  { id: "bossa", name: "Bossa nova", group: "Latin and Caribbean", time: "4/4", bpm: 130, main: { hh: "x-x-x-x-x-x-x-x-", ss: "x--x--x---x-x---", bd: "x--x----x--x----" }, fill: "latin" },
  { id: "samba", name: "Samba", group: "Latin and Caribbean", time: "4/4", bpm: 100, main: { hh: "xxxxxxxxxxxxxxxx", sn: "----x--x-x--x---", bd: "x--xx--xx--xx--x" }, fill: "latin" },
  { id: "songo", name: "Songo", group: "Latin and Caribbean", time: "4/4", bpm: 110, main: { rb: "x-x-x-x-x-x-x-x-", sn: "---x--x---x--x--", bd: "---x-------x----", tomfh: "------x-------x-" }, fill: "latin" },
  { id: "cha-cha", name: "Cha-cha", group: "Latin and Caribbean", time: "4/4", bpm: 116, main: { cb: "x---x---x---x---", tomh: "--------------xx", ss: "----x-------x---", bd: "x-------x-------" }, fill: "latin" },
  { id: "mambo", name: "Mambo", group: "Latin and Caribbean", time: "4/4", bpm: 180, main: { cb: "x-x-x-x-x-x-x-x-", ss: "----x-----x-----", bd: "---x-------x----", tomfh: "------x-------x-" }, fill: "latin" },
  { id: "cumbia", name: "Cumbia", group: "Latin and Caribbean", time: "4/4", bpm: 96, main: { hh: "x-xxx-xxx-xxx-xx", ss: "----x-------x---", bd: "x-------x-------" }, fill: "latin" },
  { id: "one-drop", name: "Reggae, one drop", group: "Latin and Caribbean", time: "4/4", bpm: 76, main: { hh: "x-x-x-x-x-x-x-x-", ss: "--------x-------", bd: "--------x-------" }, fill: "toms" },
  { id: "rockers", name: "Reggae, rockers", group: "Latin and Caribbean", time: "4/4", bpm: 80, main: { hh: "--x---x---x---x-", ss: "----x-------x---", bd: "x---x---x---x---" }, fill: "toms" },
  { id: "ska", name: "Ska", group: "Latin and Caribbean", time: "4/4", bpm: 150, main: { hh: "--x---x---x---x-", sn: "----x-------x---", bd: "x-------x-------" }, fill: "snare" },
  { id: "afrobeat", name: "Afrobeat", group: "Latin and Caribbean", time: "4/4", bpm: 110, main: { hh: "x-xxx-x-x-xxx-x-", sn: "----x--x-x--x---", bd: "x-----x---x--x--", cb: "x--x--x---x-x---" }, fill: "latin" },
  { id: "second-line", name: "Second line (New Orleans)", group: "Latin and Caribbean", time: "4/4", bpm: 100, swing: 60, main: { sn: "x--xx-x-x--xx-x-", bd: "x-----x-x-------" }, fill: "snare" },

  // ---- Jazz and blues
  { id: "swing", name: "Swing", group: "Jazz and blues", time: "4/4", bpm: 140, swing: 66, main: { cymr: "x---x-x-x---x-x-", hhp: "----x-------x---", bd: "x---------------" }, fill: "swing" },
  { id: "bebop", name: "Bebop, up tempo", group: "Jazz and blues", time: "4/4", bpm: 220, swing: 62, main: { cymr: "x---x-x-x---x-x-", hhp: "----x-------x---", sn: "------x-------x-" }, fill: "swing" },
  { id: "brushes", name: "Ballad, brushes", group: "Jazz and blues", time: "4/4", bpm: 60, swing: 66, main: { sn: "x---x-x-x---x-x-", hhp: "----x-------x---", bd: "x-------x-------" }, fill: "swing" },
  { id: "shuffle", name: "Blues shuffle", group: "Jazz and blues", time: "4/4", bpm: 100, swing: 67, main: { hh: "x-x-x-x-x-x-x-x-", sn: "----x-------x---", bd: "x-----x-x-----x-" }, fill: "swing" },
  { id: "jazz-waltz", name: "Jazz waltz", group: "Jazz and blues", time: "3/4", bpm: 150, swing: 66, main: { cymr: "x---x-x-x-x-", hhp: "----x-------", bd: "x-----------" }, fill: "toms" },
  { id: "slow-blues", name: "Slow blues (12/8)", group: "Jazz and blues", time: "12/8", bpm: 60, main: { hh: "xxxxxxxxxxxx", sn: "---x-----x--", bd: "x-----x-----" }, fill: "toms" },
  { id: "gospel-128", name: "Gospel (12/8)", group: "Jazz and blues", time: "12/8", bpm: 72, main: { cymr: "xxxxxxxxxxxx", sn: "---x-----x--", bd: "x-x---x-x---" }, fill: "snare" },

  // ---- In three, and marching
  { id: "waltz", name: "Waltz", group: "In three, and marching", time: "3/4", bpm: 140, main: { hh: "x---x---x---", ss: "----x---x---", bd: "x-----------" }, fill: "toms" },
  { id: "pop-34", name: "Pop in 3/4", group: "In three, and marching", time: "3/4", bpm: 100, main: { hh: "x-x-x-x-x-x-", sn: "----x-------", bd: "x-------x---" }, fill: "snare" },
  { id: "ballad-68", name: "6/8 ballad", group: "In three, and marching", time: "6/8", bpm: 60, main: { hh: "x-x-x-x-x-x-", ss: "------x-----", bd: "x-----x-----" }, fill: "toms" },
  { id: "rock-68", name: "6/8 rock", group: "In three, and marching", time: "6/8", bpm: 70, main: { hh: "x-x-x-x-x-x-", sn: "------x-----", bd: "x---x-------" }, fill: "snare" },
  { id: "march", name: "March", group: "In three, and marching", time: "4/4", bpm: 112, main: { sn: "x-xxx---x-xxx---", bd: "x-------x-------", cymc: "x---------------" }, fill: "rolls" },
];

/** The groove of id `id`, or null. */
export function grooveOf(id) {
  return GROOVES.find((g) => g.id === id) ?? null;
}

/** A groove's steps in a bar: the length of its lines. */
export function stepsOf(groove) {
  return Math.max(...Object.values(groove.main).map((line) => line.length));
}

/** A groove's break, as lines: its own, or the shared one it names (for its bar's steps). */
export function breakOf(groove) {
  if (typeof groove.fill === "object") return groove.fill;
  return BREAKS[stepsOf(groove)]?.[groove.fill] ?? BREAKS[stepsOf(groove)]?.snare ?? groove.main;
}

// ---- Played as a drummer plays it (#455) ---------------------------------------------

/** The beats of a bar of `time`, as the grooves count them: a dotted quarter in 6/8 and 12/8. */
export function beatsOf(time) {
  const [num, den] = time.split("/").map(Number);
  return den === 8 && num % 3 === 0 && num > 3 ? num / 3 : num;
}

const CYMBALS = new Set(["hh", "hho", "cymr", "rb", "cb", "tamb", "hhp"]);
const SNARES = new Set(["sn", "ss", "hc"]);
const TOMS = new Set(["tomh", "tommh", "tomml", "toml", "tomfh", "tomfl"]);

/**
 * How hard each stroke of `lines` (a bar of `time`) is played, 1–127, as a
 * drummer plays it: the downbeat and the backbeat strong, the hi-hat's
 * off-beats lighter and its sixteenths lighter still, a ghost note (g) barely
 * there, an accent (X) above the rest; in a break (`fill`), the snare and
 * the toms building up to the next bar. Answers [{ at, drum, velocity }].
 */
export function dynamicsOf(lines, time, { fill = false } = {}) {
  const steps = Math.max(...Object.values(lines).map((line) => line.length));
  const beats = beatsOf(time);
  const per = steps / beats;
  const place = (k) => {
    if (k === 0) return "down";
    if (k % per === 0) return "beat";
    const half = per % 3 === 0 ? per / 3 : per / 2;
    return Number.isInteger(half) && k % half === 0 ? "half" : "sub";
  };
  // The backbeat: every other beat, from the second (2 and 4; the second beat of a 6/8).
  const backbeat = (k) => k % per === 0 && (k / per) % 2 === 1;
  const out = [];
  for (const [drum, line] of Object.entries(lines)) {
    [...line].forEach((c, k) => {
      if (c === "-" || c === ".") return;
      const where = place(k);
      let v;
      if (c === "g") v = 34;
      else if (drum === "cymc") v = 116;
      else if (drum === "hhp") v = 64;
      else if (CYMBALS.has(drum)) v = { down: 96, beat: 88, half: 70, sub: 56 }[where];
      else if (drum === "bd") v = { down: 108, beat: 98, half: 88, sub: 82 }[where];
      else if (SNARES.has(drum)) v = backbeat(k) ? 110 : { down: 100, beat: 96, half: 80, sub: 70 }[where];
      else if (TOMS.has(drum)) v = 96;
      else v = 90;
      // A break builds: its snare and toms from softer to stronger across the bar.
      if (fill && c !== "g" && (SNARES.has(drum) || TOMS.has(drum))) v = Math.round(72 + (46 * k) / Math.max(1, steps - 1));
      if (c === "X") v += 16;
      out.push({ at: k, drum, velocity: Math.max(1, Math.min(127, v)) });
    });
  }
  return out;
}

/**
 * Bar `n` (from 0) of a phrase of `lines`, varied as a drummer would: from
 * the second phrase on (`crash`), a crash on its downbeat in place of the
 * hi-hat or ride there; in its third bar, the hi-hat's last off-beat opened.
 * Answers new lines; `lines` is left as it was.
 */
export function variedBar(lines, n, { crash = false } = {}) {
  const out = { ...lines };
  const steps = Math.max(...Object.values(lines).map((line) => line.length));
  const put = (drum, k, c) => {
    const line = (out[drum] ?? "-".repeat(steps)).padEnd(steps, "-");
    out[drum] = line.slice(0, k) + c + line.slice(k + 1);
  };
  if (crash && n === 0) {
    for (const ride of ["hh", "cymr", "rb"]) if (out[ride]?.[0] && out[ride][0] !== "-") put(ride, 0, "-");
    put("cymc", 0, "x");
  }
  if (n === 2 && out.hh) {
    // The last hi-hat stroke off the beat, opened: the bar breathes before the fourth.
    const per = steps / 4;
    for (let k = steps - 1; k > 0; k--) {
      if (out.hh[k] !== "-" && k % per !== 0) {
        put("hh", k, "-");
        put("hho", k, "x");
        break;
      }
    }
  }
  return out;
}

/** The humanize a drummer's playing is given (feel.js): a few milliseconds and a little force, never the same twice. */
export const DRUMMER_FEEL = { time: 8, velocity: 6, seed: 455 };
