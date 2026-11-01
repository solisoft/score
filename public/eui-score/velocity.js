// Each note's velocity — how hard it is played — set by hand under the MIDI
// view, kept with the score, heard on Play and written into the MIDI.
//
// A note is named by its lane, the tick its tie chain starts at and its MIDI
// key: "lane:tick:key" (a chord's notes apart). That survives every edit
// elsewhere in the score; a note dragged on the roll takes its velocity with
// it (`remap`), and a pitch changed in place keeps it (`reconcile`). The
// velocities are kept in the score's text:
//
//   %% eui-score {"velocity":{"0:0:60":96,"0:20160:64":70}}
//
// A note with none plays as its dynamics, hairpins and accents say (the
// engraver's MIDI): `heardVelocities` reads those, for the strip to show.
// The MIDI is written by the engraver, then each note-on with a velocity
// set is changed in place (`applyVelocities`): matched to its note by its
// channel, its key and when it is heard (score-model.js `heardAt`, every
// repeat played out).

// Served immutable: this module's version goes to the modules it loads.
const SEARCH = new URL(import.meta.url).search;
const M = await import(`./score-model.js${SEARCH}`);
const R = await import(`./piano-roll.js${SEARCH}`);
// The strip's words in the page's language (#508).
const { tr } = await import(`./words.js${SEARCH}`);

/** A note's name: its lane, the tick it starts at, its key. */
export function noteId(lane, t0, key) {
  return `${lane}:${t0}:${key}`;
}

/** The roll's notes (piano-roll.js `rollNotes`), each with its `id`. */
export function velocityNotes(score) {
  return R.rollNotes(score).map((n) => ({ ...n, id: noteId(n.lane, n.t0, n.key) }));
}

/** The velocities set: { id: 1–127 }. */
export function velocitiesOf(score) {
  return score?.meta?.velocity ?? {};
}

const clampVelocity = (v) => Math.max(1, Math.min(127, Math.round(v)));

/**
 * `changes` ({ id: velocity, or null to go back to the dynamics }) kept in
 * the score; the velocities of notes no longer there go. Answers the map.
 */
export function setVelocities(score, changes) {
  const ids = new Set(velocityNotes(score).map((n) => n.id));
  const map = { ...velocitiesOf(score) };
  for (const [id, v] of Object.entries(changes)) {
    if (v == null) delete map[id];
    else map[id] = clampVelocity(v);
  }
  for (const id of Object.keys(map)) if (!ids.has(id)) delete map[id];
  score.meta = { ...(score.meta ?? {}) };
  if (Object.keys(map).length) score.meta.velocity = map;
  else delete score.meta.velocity;
  return map;
}

/**
 * Lane `lane`'s note that started at `from` now starts at `to`, each key
 * `k` now `keyOf(k)`: its velocities go with it.
 */
export function remap(score, lane, from, to, keyOf = (k) => k) {
  const map = velocitiesOf(score);
  const moved = {};
  for (const [id, v] of Object.entries(map)) {
    const [l, t, k] = id.split(":").map(Number);
    if (l !== lane || t !== from) continue;
    moved[id] = null;
    moved[noteId(lane, to, keyOf(k))] = v;
  }
  // The new names last: an old name that is also a new one keeps its value.
  const ordered = Object.fromEntries([...Object.entries(moved).filter(([, v]) => v == null), ...Object.entries(moved).filter(([, v]) => v != null)]);
  if (Object.keys(ordered).length) setVelocities(score, ordered);
}

/**
 * After an edit (`before` → `score`): a note whose pitch changed in place —
 * same lane, same start, a key gone and a key come — keeps its velocity,
 * chords paired low to high. Velocities of notes gone are dropped.
 */
export function reconcile(before, score) {
  const map = velocitiesOf(score);
  if (!Object.keys(map).length) return;
  const was = new Set(velocityNotes(before).map((n) => n.id));
  const now = velocityNotes(score);
  const nowIds = new Set(now.map((n) => n.id));
  const changes = {};
  const byStart = new Map();
  for (const id of Object.keys(map)) {
    if (nowIds.has(id)) continue;
    const [l, t] = id.split(":");
    const at = `${l}:${t}`;
    if (!byStart.has(at)) byStart.set(at, []);
    byStart.get(at).push(id);
  }
  for (const [at, gone] of byStart) {
    const come = now.filter((n) => `${n.lane}:${n.t0}` === at && !was.has(n.id)).map((n) => n.id);
    const goneSorted = gone.sort((a, b) => Number(a.split(":")[2]) - Number(b.split(":")[2]));
    const comeSorted = come.sort((a, b) => Number(a.split(":")[2]) - Number(b.split(":")[2]));
    if (goneSorted.length !== comeSorted.length) continue;
    goneSorted.forEach((id, k) => {
      changes[comeSorted[k]] = map[id];
    });
  }
  setVelocities(score, changes);
}

// ---- What the actions do ------------------------------------------------------------

/** The velocity a note plays at: set, or as its dynamics give it (`heard`), or 90. */
export function velocityOf(id, set, heard = {}) {
  return set[id] ?? heard[id] ?? 90;
}

/** Every note in `ids` at `value`. */
export function fixed(ids, value) {
  return Object.fromEntries(ids.map((id) => [id, clampVelocity(value)]));
}

/** Every note in `ids` softer: its velocity times `factor`. */
export function soften(ids, set, heard, factor = 0.8) {
  return Object.fromEntries(ids.map((id) => [id, clampVelocity(velocityOf(id, set, heard) * factor)]));
}

/**
 * The notes in `ids` that fall on a beat played harder: `down` more on a
 * bar's first beat, `beat` more on the others; those off the beat as they are.
 */
export function accentBeats(score, ids, set, heard, { down = 20, beat = 10 } = {}) {
  const out = {};
  for (const id of ids) {
    const t = Number(id.split(":")[1]);
    const bar = M.barAt(score, t);
    const [, den] = M.timeAt(score, bar);
    // Counted back from the bar's end, as the roll draws them: a pickup's beats are its bar's last.
    const fromEnd = M.barStart(score, bar + 1) - t;
    if (fromEnd % (M.WHOLE / den) !== 0) continue;
    const first = t === M.barStart(score, bar) && M.barLength(score, bar) === (M.WHOLE * M.timeAt(score, bar)[0]) / den;
    out[id] = clampVelocity(velocityOf(id, set, heard) + (first ? down : beat));
  }
  return out;
}

/**
 * The velocities a recording was played with, for the notes it wrote into
 * lane `lane` (`played`: `{ key, t0, velocity }`, fitted to `grid` as
 * writeRecording fits them): { id: velocity }.
 */
export function fromRecording(score, lane, played, grid) {
  const ids = new Set(velocityNotes(score).filter((n) => n.lane === lane).map((n) => n.id));
  const out = {};
  for (const n of M.quantize(played, grid)) {
    const id = noteId(lane, n.t0, n.key);
    if (ids.has(id) && n.velocity) out[id] = clampVelocity(n.velocity);
  }
  return out;
}

// ---- In the MIDI ----------------------------------------------------------------------

/** A Standard MIDI File's note-ons: [{ channel, key, velocity, sec, at }], `at` the velocity's byte, `channel` the synthesizer's (port × 16 + channel). */
export function midiNoteOns(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ppq = (b[12] << 8) | b[13];
  const tempos = [];
  const ons = [];
  let i = 14;
  while (i + 8 <= b.length) {
    const length = ((b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]) >>> 0;
    let p = i + 8;
    const end = Math.min(b.length, p + length);
    let ticks = 0;
    let status = 0;
    let port = 0;
    const vlq = () => {
      let x = 0;
      for (;;) {
        const byte = b[p++];
        x = (x << 7) | (byte & 127);
        if (!(byte & 128) || p >= end) return x;
      }
    };
    while (p < end) {
      ticks += vlq();
      if (b[p] & 128) status = b[p++];
      if (status === 0xff) {
        const type = b[p++];
        const size = vlq();
        if (type === 0x51) tempos.push([ticks, (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]]);
        // A MIDI port (channels.js, past fifteen staves): 16 channels more each.
        if (type === 0x21) port = b[p];
        p += size;
      } else if (status === 0xf0 || status === 0xf7) {
        // Read first: `p += vlq()` would add to the `p` before the length was read.
        const size = vlq();
        p += size;
      } else {
        const kind = status & 0xf0;
        if (kind === 0x90 && b[p + 1] > 0) ons.push({ channel: 16 * port + (status & 15), key: b[p], velocity: b[p + 1], ticks, at: p + 1 });
        p += kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      }
    }
    i = end;
  }
  tempos.sort((x, y) => x[0] - y[0]);
  const sec = (tick) => {
    let s = 0;
    let last = 0;
    let us = 500000;
    for (const [at, u] of tempos) {
      if (at >= tick) break;
      s += ((at - last) * us) / ppq / 1e6;
      last = at;
      us = u;
    }
    return s + ((tick - last) * us) / ppq / 1e6;
  };
  return ons.map(({ ticks, ...on }) => ({ ...on, sec: sec(ticks) }));
}

/**
 * Each note-on of `bytes` (the MIDI of `score`, as Play writes it) with the
 * note it plays: [{ on, id }] — a note heard on several passes, several
 * times. A note-on no note answers (a grace note) is left out.
 */
export function matchNotes(score, bytes, tolerance = 0.03) {
  const passes = M.playback(score);
  const channelOf = new Map(M.channels(score).map((c) => [c.lane, c.channel]));
  const heard = new Map();
  for (const n of velocityNotes(score)) {
    const channel = channelOf.get(M.upperOf(score, n.lane));
    if (channel == null) continue;
    const bucket = `${channel}:${n.key}`;
    if (!heard.has(bucket)) heard.set(bucket, []);
    for (const sec of M.heardAt(score, passes, n.lane, n.index, n.t0)) heard.get(bucket).push({ sec, id: n.id, used: false });
  }
  const out = [];
  for (const on of midiNoteOns(bytes)) {
    const candidates = heard.get(`${on.channel}:${on.key}`) ?? [];
    let best = null;
    for (const c of candidates) {
      if (c.used || Math.abs(c.sec - on.sec) > tolerance) continue;
      if (!best || Math.abs(c.sec - on.sec) < Math.abs(best.sec - on.sec)) best = c;
    }
    if (!best) continue;
    best.used = true;
    out.push({ on, id: best.id });
  }
  return out;
}

/** The velocities the MIDI gives each note with none set — its dynamics, hairpins, accents: { id: velocity }, the first pass's. */
export function heardVelocities(score, bytes) {
  const out = {};
  for (const { on, id } of matchNotes(score, bytes)) out[id] ??= on.velocity;
  return out;
}

/** `bytes` (the MIDI of `score`) with the velocities set in the score: a copy, the same bytes when none are. */
export function applyVelocities(score, bytes) {
  const set = velocitiesOf(score);
  if (!score || !Object.keys(set).length) return bytes;
  const out = new Uint8Array(bytes);
  for (const { on, id } of matchNotes(score, out)) {
    if (set[id] != null) out[on.at] = clampVelocity(set[id]);
  }
  return out;
}

// ---- The strip under the roll ------------------------------------------------------------

export const STRIP_H = 84;
const PAD = 6;

/** Where velocity `v` is drawn, and back: the strip's y. */
export function yOfVelocity(v) {
  return PAD + (1 - v / 127) * (STRIP_H - 2 * PAD);
}

export function velocityOfY(y) {
  return clampVelocity(((STRIP_H - PAD - y) / (STRIP_H - 2 * PAD)) * 127);
}

/** The strip's bars: [{ id, lane, x, v, set }] for the roll's layout `geo` (piano-roll.js `rollLayout`). */
export function stripBars(score, geo, set, heard) {
  return geo.notes.map((n) => {
    const id = noteId(n.lane, n.t0, n.key);
    return { id, lane: n.lane, x: geo.x(n.t0) + 2 + (n.lane % 4) * 4, v: velocityOf(id, set, heard), set: set[id] != null };
  });
}

/** The bar under `px` (within 4 px), the nearest; null when none. */
export function barAtX(bars, px) {
  let best = null;
  for (const bar of bars) {
    const d = Math.abs(bar.x - px);
    if (d <= 4 && (!best || d < Math.abs(best.x - px))) best = bar;
  }
  return best;
}

/** The strip as SVG: a bar per note, as tall as it is loud; set ones solid, the dynamics' paler, the selected outlined. */
export function drawStrip(score, geo, { set = {}, heard = {}, selected = new Set() } = {}) {
  const bars = stripBars(score, geo, set, heard);
  const parts = [`<rect class="vel-bg" x="${geo.left}" y="0" width="${geo.width - geo.left}" height="${STRIP_H}"/>`];
  for (const v of [32, 64, 96]) parts.push(`<line class="vel-grid" x1="${geo.left}" x2="${geo.width}" y1="${yOfVelocity(v)}" y2="${yOfVelocity(v)}"/>`);
  for (let bar = 0; bar <= geo.bars; bar++) {
    const bx = geo.x(M.barStart(score, bar));
    parts.push(`<line class="vel-bar-line" x1="${bx}" x2="${bx}" y1="0" y2="${STRIP_H}"/>`);
  }
  parts.push(`<text class="vel-label" x="8" y="16">${tr("Velocity")}</text>`);
  parts.push(`<text class="vel-scale" x="${geo.left - 6}" y="${yOfVelocity(127) + 8}" text-anchor="end">127</text><text class="vel-scale" x="${geo.left - 6}" y="${STRIP_H - PAD}" text-anchor="end">1</text>`);
  for (const b of bars) {
    const y = yOfVelocity(b.v);
    const classes = ["vel-note", b.set ? "" : "vel-note-heard", selected.has(b.id) ? "vel-note-chosen" : ""].filter(Boolean).join(" ");
    parts.push(`<g class="${classes}" data-vel="${b.id}"><line x1="${b.x}" x2="${b.x}" y1="${STRIP_H - PAD}" y2="${y}" stroke="${R.laneColour(score, b.lane)}"/><circle cx="${b.x}" cy="${y}" r="3" fill="${R.laneColour(score, b.lane)}"/><title>${b.set ? b.v : tr("{velocity} (from the dynamics)", { velocity: b.v })}</title></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="vel-strip" width="${geo.width}" height="${STRIP_H}" viewBox="0 0 ${geo.width} ${STRIP_H}" role="img" aria-label="${tr("Velocity of {count} notes", { count: bars.length })}">${parts.join("")}</svg>`;
}
