// Practice (#391): the piece played transposed, slower or faster, and a
// loop whose tempo rises each time round.
//
// - Transposed: the keys of the MIDI that is heard are moved, not the
//   score — "Play transposed", ±12 semitones; the drums (the tenth
//   channel) stay where they are.
// - Slower or faster: on Play, the sequencer's own rate (player.js `rate`):
//   the pitch stays, and the piece's clock stays the score's, so the notes
//   light up and the loop jumps back where they are written. In a saved
//   file, when asked, the tempo events are scaled instead (`scaleTempo`).
// - The rising loop: from X % to Z %, Y % more each pass; at Z it stops,
//   or loops on at Z (`rampOf`, `rampAfter`).
//
// Neither touches an audio track: an audio clip (#390) played at another
// rate would change its pitch. Where its time-stretch would go is marked
// "TIME-STRETCH" below and in studio.js.
//
// No DOM here: tests/js/practice.test.mjs.

const V = new URL(import.meta.url).search;
const F = await import(`./feel.js${V}`);
const { tr } = await import(`./words.js${V}`);

export const TRANSPOSE_MIN = -12;
export const TRANSPOSE_MAX = 12;
/** The speeds Play can take, as a factor of the written tempo: 25 % to 200 %. */
export const RATE_MIN = 0.25;
export const RATE_MAX = 2;
/** The drums' channel (the tenth, in every MIDI port): never transposed. */
const DRUMS = 9;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const number = (x, fallback) => (Number.isFinite(Number(x)) && x !== "" && x != null ? Number(x) : fallback);

/** A transposition as kept: a whole number of semitones, −12 to +12. */
export function transposition(value) {
  return clamp(Math.round(number(value, 0)), TRANSPOSE_MIN, TRANSPOSE_MAX);
}

/** A speed as kept: a factor from 0.25 to 2 (1 as written). */
export function rateOf(value) {
  return clamp(number(value, 1), RATE_MIN, RATE_MAX);
}

/** "+3 semitones", "−1 semitone", "as written". */
export function transposeText(n) {
  const k = transposition(n);
  if (!k) return tr("as written");
  const signed = `${k > 0 ? "+" : "−"}${Math.abs(k)}`;
  return Math.abs(k) === 1 ? tr("{n} semitone", { n: signed }) : tr("{n} semitones", { n: signed });
}

const isNote = (data) => [0x80, 0x90, 0xa0].includes(data[0] & 0xf0);

/**
 * `bytes` (a Standard MIDI File) with every note `semitones` higher (or
 * lower), its key pressure too; the drums' channel left alone, a key past
 * the keyboard's ends kept at the end. The same bytes for 0.
 */
export function transposeMidi(bytes, semitones) {
  const n = transposition(semitones);
  if (!n) return bytes;
  const smf = F.readSmf(bytes);
  for (const events of smf.tracks) {
    for (const ev of events) {
      if (isNote(ev.data) && (ev.data[0] & 15) !== DRUMS) ev.data[1] = clamp(ev.data[1] + n, 0, 127);
    }
  }
  return F.writeSmf(smf);
}

const tempoEvent = (tick, us) => {
  const u = clamp(Math.round(us), 1, 0xffffff);
  return { tick, data: [0xff, 0x51, 3, (u >> 16) & 255, (u >> 8) & 255, u & 255] };
};

/** A tempo event's microseconds a quarter. */
export const tempoUs = (data) => (data[3] << 16) | (data[4] << 8) | data[5];

/**
 * `bytes` played `factor` times as fast (0.5: at half speed): each tempo
 * event's length of a quarter divided by it — a file without one gets the
 * MIDI default's (120 a quarter) so scaled. The same bytes for 1.
 */
export function scaleTempo(bytes, factor) {
  const f = rateOf(factor);
  if (f === 1) return bytes;
  const smf = F.readSmf(bytes);
  let found = false;
  for (const events of smf.tracks) {
    for (const ev of events) {
      if (ev.data[0] !== 0xff || ev.data[1] !== 0x51) continue;
      found = true;
      Object.assign(ev, tempoEvent(ev.tick, tempoUs(ev.data) / f));
    }
  }
  if (!found && smf.tracks.length) smf.tracks[0].unshift(tempoEvent(0, 500000 / f));
  F.sortTracks(smf);
  return F.writeSmf(smf);
}

/**
 * What the practice settings make of the heard MIDI: transposed by
 * `transpose`, and at `tempo` (a factor) when given — a saved file's; Play
 * leaves the tempo to the sequencer's rate.
 */
export function applyPractice(bytes, { transpose = 0, tempo = 1 } = {}) {
  return scaleTempo(transposeMidi(bytes, transpose), tempo);
}

// ---- The rising loop --------------------------------------------------------------------

/** What happens at the target speed: the loop stops, or goes on at it. */
export const AT_TARGET = ["stop", "loop"];

/**
 * A rising loop's settings, in range: `from` and `to` in percent (25–200,
 * `to` never below `from`), `step` percent more a pass (1–100), `atTarget`
 * "stop" or "loop".
 */
export function rampOf(stored = {}) {
  const s = stored ?? {};
  const from = Math.round(clamp(number(s.from, 70), RATE_MIN * 100, RATE_MAX * 100));
  const to = Math.round(clamp(number(s.to, 100), from, RATE_MAX * 100));
  const step = Math.round(clamp(number(s.step, 5), 1, 100));
  return { from, step, to, atTarget: AT_TARGET.includes(s.atTarget) ? s.atTarget : "stop" };
}

/** The speed of pass `pass` (0 the first), in percent: up a step each pass, never past the target. */
export function rampPercent(ramp, pass) {
  const r = rampOf(ramp);
  return Math.min(r.to, r.from + Math.max(0, pass) * r.step);
}

/**
 * After pass `pass` (0 the first) is over: `{ percent, pass, done }` — the
 * next pass and its speed; `done` when the pass just played was at the
 * target and the loop is to stop there.
 */
export function rampAfter(ramp, pass) {
  const r = rampOf(ramp);
  const was = rampPercent(r, pass);
  if (was >= r.to && r.atTarget === "stop") return { percent: was, pass, done: true };
  return { percent: rampPercent(r, pass + 1), pass: pass + 1, done: false };
}

/** The speeds of the passes up to the target, in percent: [70, 75, … 100]. */
export function rampPlan(ramp) {
  const r = rampOf(ramp);
  const out = [];
  for (let k = 0; out.at(-1) !== r.to; k++) out.push(rampPercent(r, k));
  return out;
}

/** What the Playback section says while the loop rises: "Pass 3 · 80 % (to 100 %)". */
export function rampText(ramp, pass) {
  const r = rampOf(ramp);
  const now = rampPercent(r, pass);
  const said = { pass: pass + 1, now, to: r.to };
  if (now < r.to) return tr("Pass {pass} · {now} % (to {to} %)", said);
  return r.atTarget === "loop" ? tr("Pass {pass} · {now} % (the target, looping)", said) : tr("Pass {pass} · {now} % (the target, last pass)", said);
}
