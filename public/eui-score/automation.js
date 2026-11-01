// Automation: the curves a staff's controllers follow while it plays —
// modulation, expression, volume, pan, the sustain pedal, pitch bend —
// drawn under the MIDI view, recorded from a MIDI keyboard, read from a
// MIDI file, and heard on Play, Save as MIDI and Save the sound.
//
// They are kept in the score's text, on its `%% eui-score` line, under `cc`:
//
//   %% eui-score {"cc":{"0":{"1":[[0,0],[80640,127]],"64":[[0,127],[60480,0]],"bend":[[20160,0],[40320,4096]]}}}
//
//   "cc": { "<lane>": { "<controller>": [[tick, value], …] } }
//
// - `<lane>`: the staff's lane, as the mixer keys its tracks (a staff's
//   first lane; its other voices play on its channel);
// - `<controller>`: "1" modulation, "11" expression, "7" volume, "10" pan,
//   "64" the sustain pedal, "bend" pitch bend, "pressure" channel pressure;
// - `tick`: score time (score-model.js WHOLE ticks to a whole note) from
//   the start, as written: a repeat plays its bars' curve again;
// - `value`: 0–127 for a controller (the pedal 0 or 127), −8192–8191 for
//   pitch bend (0 the centre);
// - points sorted by tick, one per tick. Between two points the value goes
//   in a straight line (the pedal steps); before the first nothing is sent;
//   after the last the value is held.
//
// In the MIDI: the engraver writes it (one track a staff), then each curve
// becomes controller or pitch-bend events in its staff's track — a point
// each, and on a ramp a value every sixteenth (`STEP`): a few a beat —
// placed by the score's ticks, so a rit. or an accel. (feel.js, after this)
// carries them along with the notes. The
// pedal written in the notation (\sustainOn, \sustainOff) wins: a staff
// whose MIDI already presses the pedal has its "64" curve left out.
//
// No DOM here (the strip's events are automation-ui.js's): tests/js/automation.test.mjs.

const SEARCH = new URL(import.meta.url).search;
const M = await import(`./score-model.js${SEARCH}`);
const F = await import(`./feel.js${SEARCH}`);
// The lane's words in the page's language (#508).
const { tr } = await import(`./words.js${SEARCH}`);

// A catalogue's names are data, and stay English: `english.tr` hands one back
// as it is, and marks it for the editor's words (#508) — where it is shown,
// words.js's `tr` says it in the page's language (config/editor_words/fr/).
const english = { tr: (text) => text };

/** The controllers a lane can follow. */
export const CONTROLLERS = [
  { id: "1", name: english.tr("Modulation"), number: 1, min: 0, max: 127 },
  { id: "11", name: english.tr("Expression"), number: 11, min: 0, max: 127 },
  { id: "7", name: english.tr("Volume"), number: 7, min: 0, max: 127 },
  { id: "10", name: english.tr("Pan"), number: 10, min: 0, max: 127 },
  { id: "64", name: english.tr("Sustain pedal"), number: 64, min: 0, max: 127, step: true },
  { id: "bend", name: english.tr("Pitch bend"), number: null, min: -8192, max: 8191 },
  // Channel pressure (aftertouch): an MPE keyboard's, the hardest of its notes (mpe.js, #391).
  { id: "pressure", name: english.tr("Pressure"), number: null, min: 0, max: 127 },
];

/** A controller by its id ("1", "bend"…); null for one not followed. */
export function controller(id) {
  return CONTROLLERS.find((c) => c.id === String(id)) ?? null;
}

/** A controller's id from a MIDI controller number; null for one not followed. */
export function idOfNumber(number) {
  return CONTROLLERS.find((c) => c.number != null && c.number === number)?.id ?? null;
}

/** On a ramp, a value every sixteenth. */
export const STEP = M.WHOLE / 16;

const clampTo = (c, v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return c.min;
  if (c.step) return n >= 64 ? 127 : 0;
  return Math.max(c.min, Math.min(c.max, n));
};

/** `points` as kept: whole ticks from 0, values in range, sorted, one a tick (the last given wins). */
export function normalize(id, points) {
  const c = controller(id);
  const byTick = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    if (!Array.isArray(point)) continue;
    const [t, v] = point;
    const tick = Math.max(0, Math.round(Number(t)));
    if (!Number.isFinite(tick)) continue;
    byTick.set(tick, clampTo(c, v));
  }
  return [...byTick].sort((a, b) => a[0] - b[0]);
}

/**
 * The score's curves: { lane: { id: points } }. Read from the score's text,
 * which anyone may have written: a staff's lane, a controller followed, its
 * points as `normalize` keeps them and a value that is no number left out —
 * what reaches the lane's SVG and the MIDI is a number (#537).
 */
export function curvesOf(score) {
  const kept = score?.meta?.cc;
  if (!kept || typeof kept !== "object" || Array.isArray(kept)) return {};
  const out = {};
  for (const [lane, curves] of Object.entries(kept)) {
    if (!/^\d+$/.test(lane) || !curves || typeof curves !== "object" || Array.isArray(curves)) continue;
    const mine = {};
    for (const [id, points] of Object.entries(curves)) {
      if (!controller(id) || !Array.isArray(points)) continue;
      const clean = normalize(id, points.filter((p) => Array.isArray(p) && typeof p[1] === "number"));
      if (clean.length) mine[id] = clean;
    }
    if (Object.keys(mine).length) out[lane] = mine;
  }
  return out;
}

/** Lane `lane`'s curve of controller `id`: [[tick, value]], [] when none. */
export function curveOf(score, lane, id) {
  return curvesOf(score)[lane]?.[id] ?? [];
}

/** Lane `lane`'s curve of `id` set to `points` (none: gone), kept in the score. Answers the points kept. */
export function setCurve(score, lane, id, points) {
  if (!controller(id)) throw new Error(`No such controller: ${id}`);
  const kept = normalize(id, points);
  const all = { ...curvesOf(score) };
  const mine = { ...(all[lane] ?? {}) };
  if (kept.length) mine[id] = kept;
  else delete mine[id];
  if (Object.keys(mine).length) all[lane] = mine;
  else delete all[lane];
  score.meta = { ...(score.meta ?? {}) };
  if (Object.keys(all).length) score.meta.cc = all;
  else delete score.meta.cc;
  return kept;
}

/** The value of `points` at `tick`: a ramp between two, held after the last; null before the first. */
export function valueAt(points, tick, id) {
  if (!points.length || tick < points[0][0]) return null;
  let i = 0;
  while (i + 1 < points.length && points[i + 1][0] <= tick) i++;
  const [t0, v0] = points[i];
  if (controller(id)?.step || i + 1 === points.length || tick === t0) return v0;
  const [t1, v1] = points[i + 1];
  return Math.round(v0 + ((v1 - v0) * (tick - t0)) / (t1 - t0));
}

// ---- Points edited --------------------------------------------------------------------

/** `points` with one more at `tick` (one there already: its value changed). */
export function withPoint(id, points, tick, value) {
  return normalize(id, [...points, [tick, value]]);
}

/** `points` with point `index` moved to `tick`, `value`; a point already at that tick gives way. */
export function movePoint(id, points, index, tick, value) {
  const rest = points.filter((_, k) => k !== index);
  return normalize(id, [...rest, [tick, value]]);
}

/** `points` without point `index`. */
export function withoutPoint(id, points, index) {
  return normalize(id, points.filter((_, k) => k !== index));
}

/**
 * Fewer points, the curve kept within `tolerance` of its value
 * (Ramer–Douglas–Peucker): what a knob turned for a minute leaves, a few
 * dozen points. The pedal keeps each change, and only them.
 */
export function thin(id, points, tolerance = id === "bend" ? 96 : 2) {
  const all = normalize(id, points);
  if (controller(id)?.step) return all.filter((p, k) => k === 0 || p[1] !== all[k - 1][1]);
  // A value held: its first and last point only.
  const flat = all.filter((p, k) => k === 0 || k === all.length - 1 || !(p[1] === all[k - 1][1] && p[1] === all[k + 1][1]));
  if (flat.length < 3) return flat;
  const keep = new Array(flat.length).fill(false);
  keep[0] = keep[flat.length - 1] = true;
  const stack = [[0, flat.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let far = tolerance;
    for (let k = a + 1; k < b; k++) {
      const [t, v] = flat[k];
      const line = flat[a][1] + ((flat[b][1] - flat[a][1]) * (t - flat[a][0])) / Math.max(1, flat[b][0] - flat[a][0]);
      const d = Math.abs(v - line);
      if (d > far) {
        far = d;
        worst = k;
      }
    }
    if (worst < 0) continue;
    keep[worst] = true;
    stack.push([a, worst], [worst, b]);
  }
  return flat.filter((_, k) => keep[k]);
}

/**
 * A recording's controllers written into lane `lane`: `played` is
 * { id: [[tick, value]] } as they came; between `from` and `to` (ticks) the
 * curves recorded replace what was there, thinned. Curves not touched stay.
 */
export function writeRecorded(score, lane, played, from, to) {
  for (const [id, raw] of Object.entries(played ?? {})) {
    if (!controller(id) || !raw?.length) continue;
    const inside = thin(id, raw.filter(([t]) => t >= from && t < to));
    if (!inside.length) continue;
    const outside = curveOf(score, lane, id).filter(([t]) => t < from || t >= to);
    setCurve(score, lane, id, [...outside, ...inside]);
  }
}

/** Whether lane `lane`'s staff has the sustain pedal written in its notes (any of its voices). */
export function notatedPedal(score, lane) {
  const upper = M.upperOf(score, lane);
  return M.voiceLanes(score, upper).some((s) => score.staves[s]?.events.some((ev) => ev.pedalOn || ev.pedalOff));
}

// ---- The events played ------------------------------------------------------------------

/**
 * The curves as MIDI events, in the order they sound, every repeat played
 * out: [{ at, channel, id, value, data }], `at` in the score's ticks from
 * the start of the music as played (each pass after the last, a fermata's
 * hold counted where the engraver's MIDI holds it: score-model.js
 * `passTicks`). A value is sent where it changes: at a point, on a ramp
 * every STEP, and where a jump (a repeat) lands on a different value.
 * `skip(channel, id)` leaves a curve out.
 */
export function automationEvents(score, { passes = M.playback(score), skip = () => false } = {}) {
  const curves = curvesOf(score);
  const lanes = Object.keys(curves);
  if (!lanes.length) return [];
  const channelOf = new Map(M.channels(score).map((c) => [c.lane, c.channel]));
  // Where each pass starts, in played ticks.
  const starts = [];
  let total = 0;
  for (const p of passes) {
    starts.push(total);
    total += M.passTicks(score, p);
  }
  const out = [];
  for (const laneText of lanes) {
    const lane = Number(laneText);
    const channel = channelOf.get(lane);
    if (channel == null) continue;
    for (const [id, points] of Object.entries(curves[laneText])) {
      const c = controller(id);
      if (!c || !points.length || skip(channel, id)) continue;
      let last = null;
      passes.forEach((p, k) => {
        const from = M.barStart(score, p.bar);
        const to = M.barStart(score, p.bar + 1);
        const ticks = new Set([from]);
        points.forEach(([t, v], n) => {
          if (t >= from && t < to) ticks.add(t);
          const next = points[n + 1];
          if (c.step || !next || next[1] === v || next[0] <= from || t >= to) return;
          // On a ramp: every STEP from its start, inside this bar.
          for (let u = t + Math.max(1, Math.ceil((from - t) / STEP)) * STEP; u < next[0] && u < to; u += STEP) if (u >= from) ticks.add(u);
        });
        for (const tick of [...ticks].sort((x, y) => x - y)) {
          const value = valueAt(points, tick, id);
          if (value == null || value === last) continue;
          last = value;
          const into = tick - from;
          const held = p.holds.filter((h) => h.at <= into).reduce((sum, h) => sum + h.ticks, 0);
          out.push({ at: starts[k] + into + held, channel, id, value, data: eventBytes(channel, id, value) });
        }
      });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

/** A controller's value as its MIDI message. */
export function eventBytes(channel, id, value) {
  if (id === "bend") {
    const v = Math.max(0, Math.min(16383, value + 8192));
    return [0xe0 | (channel & 15), v & 127, v >> 7];
  }
  if (id === "pressure") return [0xd0 | (channel & 15), Math.max(0, Math.min(127, value))];
  // A second port's channel (16 and on) is written as its channel in the port.
  return [0xb0 | (channel & 15), controller(id).number, value];
}

// ---- The MIDI file, rewritten ------------------------------------------------------------
//
// feel.js reads and writes the file (one reader for #379's swing and this).

const isChannel = (data) => data[0] >= 0x80 && data[0] < 0xf0;
const isNoteOn = (data) => (data[0] & 0xf0) === 0x90 && data[2] > 0;
const isEnd = (data) => data[0] === 0xff && data[1] === 0x2f;

/**
 * Track `events` with `added` ([{ tick, data }], sorted) laid in: each
 * after what the track holds at its tick, but before the notes struck
 * there — the controller is set when the note sounds. The end of the
 * track stays last.
 */
export function mergeEvents(events, added) {
  const out = [];
  let k = 0;
  const body = events.filter((e) => !isEnd(e.data));
  for (const e of body) {
    while (k < added.length && (added[k].tick < e.tick || (added[k].tick === e.tick && isNoteOn(e.data)))) out.push(added[k++]);
    out.push(e);
  }
  while (k < added.length) out.push(added[k++]);
  const last = out.length ? Math.max(...out.map((e) => e.tick)) : 0;
  const end = events.find((e) => isEnd(e.data));
  out.push({ tick: Math.max(last, end?.tick ?? 0), data: [0xff, 0x2f, 0] });
  return out;
}

/** A mixer fader (dB) as Channel Volume, General MIDI's curve (40·log10): 0 dB is 100, the default. */
export function volumeCc(db, volumeMin = -60) {
  if (db <= volumeMin) return 0;
  return Math.max(0, Math.min(127, Math.round(100 * 10 ** (db / 40))));
}

/** A mixer pan (−1…1) as Pan (CC 10): 64 the centre. */
export function panCc(pan) {
  const p = Math.max(-1, Math.min(1, Number(pan) || 0));
  return Math.round(64 + p * (p < 0 ? 64 : 63));
}

/**
 * `bytes` (the MIDI of `score`, as Play writes it) with the score's curves
 * in it: a copy, the same bytes when there is nothing to add.
 *
 * `mix` (Save as MIDI): each staff's mixer volume and pan as CC 7 and CC 10
 * at its start, its volume curve scaled by its fader; a pan curve takes
 * over from the mixer's pan at its first point. Play and Save the sound
 * leave them out: the mixer's graph does that, on the sound — but for
 * `mixLanes`, the staves whose mixer strip another staff's sound goes
 * through too (mixer.js `fileMixLanes`, past fifteen channels).
 */
export function applyAutomation(score, bytes, { passes = null, mix = null, mixLanes = null, volumeMin = -60 } = {}) {
  if (!score || (!Object.keys(curvesOf(score)).length && !mix)) return bytes;
  const smf = F.readSmf(bytes);
  // Each synthesizer channel's track: port × 16 + channel (channels.js).
  const trackOf = new Map();
  const ports = smf.tracks.map((track) => 16 * (track.find((e) => e.data[0] === 0xff && e.data[1] === 0x21)?.data[3] ?? 0));
  smf.tracks.forEach((track, k) => {
    for (const e of track) if (isChannel(e.data) && !trackOf.has(ports[k] + (e.data[0] & 15))) trackOf.set(ports[k] + (e.data[0] & 15), k);
  });
  // The pedal written in the notes: its staff's curve is left out.
  const pedalled = new Set(smf.tracks.flatMap((track, k) => track.filter((e) => (e.data[0] & 0xf0) === 0xb0 && e.data[1] === 64).map((e) => ports[k] + (e.data[0] & 15))));
  // The score's ticks in the file's: its quarter over the file's.
  const ratio = M.WHOLE / 4 / smf.division;
  const fader = new Map();
  const added = new Map();
  const add = (channel, tick, data) => {
    if (!added.has(channel)) added.set(channel, []);
    added.get(channel).push({ tick, data });
  };
  if (mix) {
    for (const { lane, channel } of M.channels(score)) {
      if (mixLanes && !mixLanes.includes(lane)) continue;
      const t = mix.tracks?.[lane] ?? {};
      const db = Number(t.volume ?? 0);
      fader.set(channel, db <= volumeMin ? 0 : 10 ** (db / 40));
      add(channel, 0, [0xb0 | (channel & 15), 7, volumeCc(db, volumeMin)]);
      add(channel, 0, [0xb0 | (channel & 15), 10, panCc(t.pan ?? 0)]);
    }
  }
  const skip = (channel, id) => id === "64" && pedalled.has(channel);
  for (const e of automationEvents(score, { passes: passes?.length ? passes : M.playback(score), skip })) {
    let data = e.data;
    if (e.id === "7" && fader.has(e.channel)) data = [e.data[0], 7, Math.max(0, Math.min(127, Math.round(e.value * fader.get(e.channel))))];
    add(e.channel, Math.round(e.at / ratio), data);
  }
  if (!added.size) return bytes;
  const tracks = smf.tracks.map((t) => t.slice());
  for (const [channel, list] of added) {
    list.sort((x, y) => x.tick - y.tick);
    let k = trackOf.get(channel);
    if (k == null) {
      tracks.push(channel >= 16 ? [{ tick: 0, data: [0xff, 0x21, 1, channel >> 4] }] : []);
      k = tracks.length - 1;
      trackOf.set(channel, k);
    }
    tracks[k] = mergeEvents(tracks[k], list);
  }
  return F.writeSmf({ ...smf, tracks });
}

// ---- The lane under the roll ------------------------------------------------------------

export const LANE_H = 84;
const PAD = 8;

/** Where value `v` of controller `id` is drawn, and back. */
export function yOfValue(id, v) {
  const c = controller(id);
  return PAD + (1 - (v - c.min) / (c.max - c.min)) * (LANE_H - 2 * PAD);
}

export function valueOfY(id, y) {
  const c = controller(id);
  return clampTo(c, c.min + ((LANE_H - PAD - y) / (LANE_H - 2 * PAD)) * (c.max - c.min));
}

/** The tick under `px` on the roll's layout `geo`, on a grid of `grid` ticks. */
export function tickOfX(geo, px, grid = M.WHOLE / 32) {
  const t = Math.max(0, (px - geo.left) / geo.perTick);
  return grid > 1 ? Math.round(t / grid) * grid : Math.round(t);
}

/** The point of `points` under (`px`, `py`), within 6 px: its index, or −1. */
export function pointAt(geo, id, points, px, py) {
  let best = -1;
  let bestD = 6;
  points.forEach(([t, v], k) => {
    const d = Math.hypot(geo.x(t) - px, yOfValue(id, v) - py);
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

const escape = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/** A value as words: "64", "on"/"off" for the pedal, "+2048" for a bend. */
export function valueText(id, v) {
  if (id === "64") return v >= 64 ? "on" : "off";
  if (id === "bend") return v > 0 ? `+${v}` : String(v);
  return String(v);
}

/**
 * The lane as SVG, for the roll's layout `geo`: the curve of `points` from
 * its first point to the roll's end (a step for the pedal), a dot per
 * point (`chosen` outlined), the bars' lines, and what it is (`label`).
 * `muted` says why it is not heard.
 */
export function drawLane(score, geo, id, points, { label = "", colour = "#2563c9", chosen = -1, muted = "" } = {}) {
  const c = controller(id);
  const parts = [`<rect class="cc-bg" x="${geo.left}" y="0" width="${geo.width - geo.left}" height="${LANE_H}"/>`];
  const mid = c.id === "bend" ? 0 : c.id === "10" ? 64 : null;
  for (const v of mid == null ? [32, 64, 96] : [mid]) parts.push(`<line class="cc-grid" x1="${geo.left}" x2="${geo.width}" y1="${yOfValue(id, v)}" y2="${yOfValue(id, v)}"/>`);
  for (let bar = 0; bar <= geo.bars; bar++) {
    const bx = geo.x(M.barStart(score, bar));
    parts.push(`<line class="cc-bar-line" x1="${bx}" x2="${bx}" y1="0" y2="${LANE_H}"/>`);
  }
  parts.push(`<text class="cc-label" x="8" y="16">${tr(c.name)}</text>`);
  if (label) parts.push(`<text class="cc-scale" x="8" y="30">${escape(label)}</text>`);
  parts.push(`<text class="cc-scale" x="${geo.left - 6}" y="${yOfValue(id, c.max) + 8}" text-anchor="end">${valueText(id, c.max)}</text><text class="cc-scale" x="${geo.left - 6}" y="${LANE_H - PAD}" text-anchor="end">${valueText(id, c.min)}</text>`);
  if (points.length) {
    const xy = [];
    points.forEach(([t, v], k) => {
      const x = geo.x(t);
      const y = yOfValue(id, v);
      if (c.step && k > 0) xy.push(`${x},${yOfValue(id, points[k - 1][1])}`);
      xy.push(`${x},${y}`);
    });
    xy.push(`${geo.width},${yOfValue(id, points.at(-1)[1])}`);
    parts.push(`<polyline class="cc-curve${muted ? " cc-curve-muted" : ""}" points="${xy.join(" ")}" stroke="${colour}"/>`);
    points.forEach(([t, v], k) => {
      parts.push(`<circle class="cc-point${k === chosen ? " cc-point-chosen" : ""}" data-cc-point="${k}" cx="${geo.x(t)}" cy="${yOfValue(id, v)}" r="4" fill="${colour}"><title>${escape(valueText(id, v))}</title></circle>`);
    });
  } else parts.push(`<text class="cc-empty" x="${geo.left + 12}" y="${LANE_H / 2 + 4}">${tr("Click to add a point")}</text>`);
  if (muted) parts.push(`<text class="cc-muted" x="${geo.left + 12}" y="${LANE_H - 12}">${muted}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="cc-strip" width="${geo.width}" height="${LANE_H}" viewBox="0 0 ${geo.width} ${LANE_H}" role="img" aria-label="${tr("{name}: {count} points", { name: tr(c.name), count: points.length })}">${parts.join("")}</svg>`;
}
