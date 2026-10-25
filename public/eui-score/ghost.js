// Note input's pen and ghost note (#398): what the pointer over a staff
// would write — the staff's line or space read as a pitch through its clef,
// the column it is over as a time, snapped as the cursor moves — and the
// ghost drawn there. Pure: no page, no score model; studio-ghost.js uses it.

/** The pen the pointer becomes over the staves in note input: its nib, bottom left, is the hotspot. */
export const PEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M15.5 3.5l5 5L9 20l-6.5 1.5L4 15z" fill="#fff"/><path d="M13 6l5 5"/><path d="M4 15l5 5"/><path d="M2.5 21.5l2-2"/></svg>`;

// Where each clef puts the staff's bottom line, as a pitch's `d` (score-model.js: c' is 7).
const BOTTOM_LINE = {
  treble: 9, // e'
  treble_8: 2, // e
  "treble^8": 16, // e''
  bass: -3, // g,
  bass_8: -10, // g,,
  "bass^8": 4, // g
  alto: 3, // f
  tenor: 1, // d
  soprano: 7, // c'
  // A drum staff: where eui-score draws the drums (score-model.js, DRUMS).
  percussion: 3,
};

/** The `d` of clef `clef`'s bottom line (an unknown clef reads as treble). */
export function bottomLine(clef) {
  return BOTTOM_LINE[clef] ?? BOTTOM_LINE.treble;
}

/** The staff position at drawing height `y`: steps above the bottom line (0 the bottom line, 8 the top one, odd the spaces). */
export function stepAt(y, top, space) {
  return Math.round((top + 4 * space - y) / (space / 2));
}

/** The drawing height of staff position `step`. */
export function yOfStep(step, top, space) {
  return top + 4 * space - (step * space) / 2;
}

const mod7 = (d) => ((d % 7) + 7) % 7;
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const NAMES = ["C", "D", "E", "F", "G", "A", "B"];

/** The alteration key `fifths` gives the step of `d`. */
export function keyAlter(d, fifths) {
  const k = SHARP_ORDER.indexOf(mod7(d));
  if (fifths > 0) return k < fifths ? 1 : 0;
  if (fifths < 0) return 6 - k < -fifths ? -1 : 0;
  return 0;
}

/** The pitch at staff position `step` under clef `clef`, as key `fifths` alters it: { d, alter }. */
export function pitchAt(clef, step, fifths = 0) {
  const d = bottomLine(clef) + step;
  return { d, alter: keyAlter(d, fifths) };
}

/** A pitch's MIDI key. */
export function midiOf({ d, alter }) {
  return 12 * (Math.floor(d / 7) + 4) + NATURAL[mod7(d)] + alter;
}

/** As people read it: "F♯5". */
export function nameOf({ d, alter }) {
  return NAMES[mod7(d)] + ({ "-1": "♭", 1: "♯" }[alter] ?? "") + (Math.floor(d / 7) + 3);
}

/** Whether a note can be written at that pitch (score-model.js keeps notes to A0–C8). */
export function reachable(p) {
  const key = midiOf(p);
  return p.d >= -7 && p.d <= 42 && key >= 21 && key <= 108;
}

/** The ledger lines a head at `step` needs, as the steps they are drawn at. */
export function ledgers(step) {
  const out = [];
  for (let line = -2; line >= step; line -= 2) out.push(line);
  for (let line = 10; line <= step; line += 2) out.push(line);
  return out;
}

/** The drum drawn at `d` on a drum staff, the first the palette offers there; null where none is. */
export function drumAt(d, drums) {
  return drums.find((drum) => drum.d === d)?.name ?? null;
}

/**
 * The time a click at `x` writes at, in a bar of one lane.
 *
 * `spans`: the lane's events in the bar, in order, each { t, ticks, x, rest,
 * tuplet } with `x` where it is drawn; `end`: the bar's right edge; `origin`:
 * the bar's start; `unit`: the duration being written. Over a note, a tuplet
 * or a rest no longer than `unit`, the time is the event's start, as the
 * cursor goes; over a longer rest, it is the rest's start or a multiple of
 * `unit` from the bar line inside it, as far along as the pointer is.
 * `lead`: how far left of an event the pointer is already over it (a head
 * is placed by its left edge). Answers null for no events.
 */
export function snapTime(spans, x, end, origin, unit, lead = 0) {
  if (!spans.length) return null;
  let k = 0;
  spans.forEach((span, i) => {
    if (span.x <= x + lead) k = i;
  });
  const span = spans[k];
  if (!span.rest || span.tuplet || span.ticks <= unit) return span.t;
  const next = k + 1 < spans.length ? spans[k + 1].x : end;
  if (next <= span.x) return span.t;
  const along = Math.max(0, Math.min(1, (x - span.x) / (next - span.x)));
  const raw = span.t + along * span.ticks;
  let t = span.t;
  for (let grid = origin + Math.ceil((span.t - origin) / unit) * unit; grid < span.t + span.ticks; grid += unit) {
    if (grid <= raw) t = grid;
  }
  return t;
}

/** How many flags a duration has (8 is an eighth). */
export function flagsOf(base) {
  return base >= 8 ? Math.round(Math.log2(base)) - 2 : 0;
}

/**
 * The ghost's picture, in pixels, around its head's centre: the head of
 * duration `base` (hollow from a half up), its stem and flags, its dots, the
 * ledger lines it needs and the key's accidental. `sp`: a staff space in pixels.
 */
export function ghostSvg({ step, base, dots = 0, alter = 0, sp }) {
  const r = (n) => Math.round(n * 100) / 100;
  const w = 4 * sp;
  const h = 10 * sp;
  const parts = [];
  for (const line of ledgers(step)) {
    const y = ((step - line) * sp) / 2;
    parts.push(`<line x1="${r(-1.05 * sp)}" y1="${r(y)}" x2="${r(1.05 * sp)}" y2="${r(y)}" stroke-width="${r(Math.max(1, sp / 8))}"/>`);
  }
  const hollow = base <= 2;
  parts.push(`<ellipse cx="0" cy="0" rx="${r(0.62 * sp)}" ry="${r(0.44 * sp)}" transform="rotate(-20)" ${hollow ? `fill="none" stroke-width="${r(Math.max(1, sp / 7))}"` : 'stroke="none"'}/>`);
  if (base >= 2) {
    const up = step < 4;
    const x = up ? 0.56 * sp : -0.56 * sp;
    const tip = up ? -3.4 * sp : 3.4 * sp;
    parts.push(`<line x1="${r(x)}" y1="0" x2="${r(x)}" y2="${r(tip)}" stroke-width="${r(Math.max(1, sp / 9))}"/>`);
    for (let k = 0; k < flagsOf(base); k++) {
      const y = tip + (up ? 1 : -1) * k * 0.8 * sp;
      const bend = up ? 1 : -1;
      parts.push(`<path d="M${r(x)} ${r(y)} q${r(0.9 * sp)} ${r(bend * 0.7 * sp)} ${r(0.7 * sp)} ${r(bend * 1.9 * sp)}" fill="none" stroke-width="${r(Math.max(1, sp / 7))}"/>`);
    }
  }
  const dotY = step % 2 === 0 ? -sp / 2 : 0;
  for (let k = 0; k < dots; k++) parts.push(`<circle cx="${r((1.05 + 0.5 * k) * sp)}" cy="${r(dotY)}" r="${r(0.16 * sp)}" stroke="none"/>`);
  if (alter) parts.push(`<text x="${r(-1.05 * sp)}" y="${r(0.45 * sp)}" text-anchor="end" font-size="${r(1.6 * sp)}" stroke="none">${alter > 0 ? "♯" : "♭"}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="${r(-w / 2)} ${r(-h / 2)} ${r(w)} ${r(h)}" fill="currentColor" stroke="currentColor" aria-hidden="true">${parts.join("")}</svg>`;
}
