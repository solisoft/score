// How the music is played, over what is written (#379): swing, humanize and
// the tempo's glides, put into the MIDI file the engraver writes — the one
// Play plays, Save the sound renders and Save as MIDI saves. The score is not
// touched: the settings ride in its meta line (score-model.js readMeta),
// under `swing` and `humanize`.
//
// - Swing: { amount, unit } — the first of each pair of eighths (unit 8) or
//   sixteenths (16) lasts `amount` % of the pair: 50 straight, 67 a triplet
//   feel, 75 a dotted one. Counted from each bar line.
// - Humanize: { time, velocity, seed } — each note struck up to `time` ms
//   early or late and up to `velocity` % softer or harder, the same each
//   time for the same seed. Velocity is changed here only, on top of the
//   dynamics and of any velocity the score keeps.
// - Tempo ramps: the bars score-model.js's playback() makes glide (a rit.,
//   an accel.) are given a tempo event every sixteenth.
//
//   import { feel } from "/eui-score/feel.js";
//   const played = feel(bytes, { score, passes, swing, humanize });

const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);

// ---- Standard MIDI Files, read and written ---------------------------------------------

/** A Standard MIDI File as { format, division, tracks: [[{ tick, data }]] }: every event whole, running status spelt out. */
export function readSmf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = { format: v.getUint16(8), division: v.getUint16(12), tracks: [] };
  for (let i = 8 + v.getUint32(4); i + 8 <= b.length; i += 8 + v.getUint32(i + 4)) {
    let p = i + 8;
    const end = p + v.getUint32(i + 4);
    const events = [];
    let tick = 0;
    let status = 0;
    const vlq = () => {
      let x = 0;
      for (;;) {
        const c = b[p++];
        x = x * 128 + (c & 127);
        if (!(c & 128)) return x;
      }
    };
    while (p < end) {
      tick += vlq();
      const start = p;
      if (b[p] === 0xff || b[p] === 0xf0 || b[p] === 0xf7) {
        // A meta event (type, length, data) or a sysex (length, data).
        p += b[p] === 0xff ? 2 : 1;
        const size = vlq();
        p += size;
        events.push({ tick, data: Array.from(b.subarray(start, p)) });
        continue;
      }
      if (b[p] & 128) status = b[p++];
      const kind = status & 0xf0;
      const size = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      events.push({ tick, data: [status, ...b.subarray(p, p + size)] });
      p += size;
    }
    out.tracks.push(events);
  }
  return out;
}

const vlqBytes = (n) => {
  const out = [n & 127];
  for (let x = Math.floor(n / 128); x > 0; x = Math.floor(x / 128)) out.unshift((x & 127) | 128);
  return out;
};

/** `smf` (as readSmf gives it) as bytes; each track's events in the order given, their ticks never going back. */
export function writeSmf(smf) {
  const chunks = [];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, smf.format, (smf.tracks.length >> 8) & 255, smf.tracks.length & 255, (smf.division >> 8) & 255, smf.division & 255];
  chunks.push(header);
  for (const events of smf.tracks) {
    const body = [];
    let last = 0;
    for (const ev of events) {
      const tick = Math.max(last, Math.round(ev.tick));
      body.push(...vlqBytes(tick - last), ...ev.data);
      last = tick;
    }
    const n = body.length;
    chunks.push([0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255], body);
  }
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const isMeta = (ev, type) => ev.data[0] === 0xff && (type == null || ev.data[1] === type);
const isOn = (ev) => (ev.data[0] & 0xf0) === 0x90 && ev.data[2] > 0;
const isOff = (ev) => (ev.data[0] & 0xf0) === 0x80 || ((ev.data[0] & 0xf0) === 0x90 && ev.data[2] === 0);
const isChannel = (ev) => ev.data[0] >= 0x80 && ev.data[0] < 0xf0;

/** Each track sorted by tick: a note's end before another's start on the same tick, the end of track last. */
export function sortTracks(smf) {
  for (const events of smf.tracks) {
    const end = events.filter((ev) => isMeta(ev, 0x2f));
    const rest = events.filter((ev) => !isMeta(ev, 0x2f));
    rest.forEach((ev, k) => (ev.order = k));
    rest.sort((a, b) => a.tick - b.tick || (isOff(b) && isOn(a)) - (isOff(a) && isOn(b)) || a.order - b.order);
    const last = rest.reduce((max, ev) => Math.max(max, ev.tick), 0);
    for (const ev of end) ev.tick = Math.max(ev.tick, last);
    events.splice(0, events.length, ...rest, ...end);
    for (const ev of events) delete ev.order;
  }
}

// ---- Where the bars are in the file -----------------------------------------------------

/**
 * Each pass's place in the MIDI file: [{ pass, tick, ticks }], in the file's
 * ticks — the model's ticks over `ratio` (its quarter over the file's).
 */
function barsInFile(score, passes, division) {
  const ratio = M.WHOLE / 4 / division;
  let tick = 0;
  return passes.map((pass) => {
    const ticks = M.passTicks(score, pass) / ratio;
    const bar = { pass, tick, ticks, ratio };
    tick += ticks;
    return bar;
  });
}

/** The bar a file tick is in: the last that starts at it or before. */
function barOf(bars, tick) {
  let k = 0;
  while (k + 1 < bars.length && bars[k + 1].tick <= tick + 1e-6) k++;
  return bars[k];
}

// ---- Swing ------------------------------------------------------------------------------

/**
 * Where `tick` goes, swung: in each pair of `unit` ticks counted from
 * `from`, the first part is stretched to `amount` (0.5 to 0.75) of the pair
 * and the second squeezed — the pair's edges stay put.
 */
export function swingTick(tick, from, unit, amount) {
  const pair = 2 * unit;
  const into = tick - from;
  const phase = ((into % pair) + pair) % pair;
  const start = into - phase;
  const moved = phase < unit ? phase * 2 * amount : pair * amount + (phase - unit) * 2 * (1 - amount);
  return from + start + moved;
}

/** Swing settings made sane: null when there is nothing to swing. */
export function swingOf(swing) {
  const amount = Number(swing?.amount);
  if (!swing || !(amount > 50)) return null;
  return { amount: Math.min(75, amount) / 100, unit: Number(swing.unit) === 16 ? 16 : 8 };
}

function applySwing(smf, swing, bars) {
  const unit = (smf.division * 4) / swing.unit;
  for (const events of smf.tracks) {
    for (const ev of events) {
      if (!isChannel(ev)) continue;
      const bar = bars.length ? barOf(bars, ev.tick) : { tick: 0 };
      ev.tick = swingTick(ev.tick, bar.tick, unit, swing.amount);
    }
  }
}

// ---- Humanize ---------------------------------------------------------------------------

/** A repeatable random number in [-1, 1) from `seed` (mulberry32). */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Humanize settings made sane: null when there is nothing to do. */
export function humanizeOf(humanize) {
  const time = Math.max(0, Math.min(100, Number(humanize?.time) || 0));
  const velocity = Math.max(0, Math.min(50, Number(humanize?.velocity) || 0));
  if (!time && !velocity) return null;
  return { time, velocity, seed: Number(humanize.seed) || 1 };
}

/** File ticks a millisecond is worth at `tick`: from the bar's own length in seconds, else the file's first tempo. */
function ticksPerMs(smf, bars, tick) {
  if (bars.length) {
    const bar = barOf(bars, tick);
    const sec = bar.pass.end - bar.pass.start;
    if (sec > 0) return bar.ticks / (sec * 1000);
  }
  const tempo = smf.tracks.flat().find((ev) => isMeta(ev, 0x51));
  const us = tempo ? (tempo.data[3] << 16) | (tempo.data[4] << 8) | tempo.data[5] : 500000;
  return smf.division / (us / 1000);
}

function applyHumanize(smf, humanize, bars) {
  const next = random(humanize.seed);
  for (const events of smf.tracks) {
    const open = new Map();
    const notes = [];
    for (const ev of events) {
      const key = `${ev.data[0] & 15}:${ev.data[1]}`;
      if (isOn(ev)) {
        const shift = next() * humanize.time * ticksPerMs(smf, bars, ev.tick);
        const louder = next() * humanize.velocity;
        const note = { on: ev, off: null, shift };
        ev.data[2] = Math.max(1, Math.min(127, Math.round(ev.data[2] * (1 + louder / 100))));
        if (!open.has(key)) open.set(key, []);
        open.get(key).push(note);
        notes.push({ key, note });
      } else if (isOff(ev)) {
        const note = open.get(key)?.shift();
        if (note) note.off = ev;
      }
    }
    for (const { note } of notes) {
      note.on.tick = Math.max(0, note.on.tick + note.shift);
      if (note.off) note.off.tick = Math.max(note.on.tick, note.off.tick + note.shift);
    }
    // A key struck again: the note before it ends there at the latest.
    const byKey = new Map();
    for (const { key, note } of notes) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(note);
    }
    for (const list of byKey.values()) {
      list.sort((a, b) => a.on.tick - b.on.tick);
      list.forEach((note, k) => {
        if (note.off && list[k + 1]) note.off.tick = Math.min(note.off.tick, list[k + 1].on.tick);
      });
    }
  }
}

// ---- The tempo's glides -----------------------------------------------------------------

/** A Set Tempo event: microseconds a quarter. */
const tempoEvent = (tick, us) => {
  const u = Math.max(1, Math.min(0xffffff, Math.round(us)));
  return { tick, data: [0xff, 0x51, 3, (u >> 16) & 255, (u >> 8) & 255, u & 255] };
};

/**
 * The file's tempo events, written again from the passes: one at each bar
 * that changes speed, and one every sixteenth through a bar that glides —
 * its speed over that sixteenth.
 */
export function tempoEvents(score, passes, division) {
  const bars = barsInFile(score, passes, division);
  const out = [];
  let last = 0;
  const add = (tick, us) => {
    if (Math.abs(us - last) < 1) return;
    out.push(tempoEvent(tick, us));
    last = us;
  };
  for (const bar of bars) {
    const p = bar.pass;
    if (!p.curve) {
      add(bar.tick, 60e6 / ((p.bpm * 4) / p.base));
      continue;
    }
    const length = M.passTicks(score, p);
    const step = M.WHOLE / 16;
    for (let u = 0; u < length; u += step) {
      const u1 = Math.min(length, u + step);
      const sec = M.passSeconds(p, u1) - M.passSeconds(p, u);
      add(bar.tick + u / bar.ratio, (sec * 1e6) / ((u1 - u) / (M.WHOLE / 4)));
    }
  }
  return out;
}

// ---- All of it --------------------------------------------------------------------------

/**
 * `bytes` (a MIDI file the engraver wrote from `score`, every repeat played
 * out) as it is to be heard: swung, humanized, its rit. and accel. gliding.
 * `passes` is score-model.js's playback() of that score; without a score
 * (a piece edited in its text) swing counts from the start and nothing glides.
 * Answers the bytes as they were when there is nothing to do.
 */
export function feel(bytes, { score = null, passes = [], swing = null, humanize = null } = {}) {
  const swung = swingOf(swing);
  const human = humanizeOf(humanize);
  const glides = score && passes.some((p) => p.curve);
  if (!swung && !human && !glides) return bytes;
  const smf = readSmf(bytes);
  const bars = score && passes.length ? barsInFile(score, passes, smf.division) : [];
  if (swung) applySwing(smf, swung, bars);
  if (human) applyHumanize(smf, human, bars);
  if (glides) {
    for (const events of smf.tracks) events.splice(0, events.length, ...events.filter((ev) => !isMeta(ev, 0x51)));
    smf.tracks[0].push(...tempoEvents(score, passes, smf.division));
  }
  sortTracks(smf);
  return writeSmf(smf);
}

/** The feel a score's meta line asks for: { swing, humanize }. */
export function feelOf(meta) {
  return { swing: meta?.swing ?? null, humanize: meta?.humanize ?? null };
}
