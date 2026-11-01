// The MIDI view of a score, drawn as an SVG string. Two layouts:
//
// - "tracks" (the default): a short strip per lane, every track in sight, its
//   notes scaled to its own range: a section is picked as a rectangle of
//   bars and tracks;
// - "keys": a piano roll, a row per semitone, every lane on one keyboard.
//
// It shows what sounds (concert pitch, ties joined). The studio puts it in
// place of the engraving and reads clicks back with `rollHit`.

// Served immutable: this module's version goes to the model it loads.
const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);
const { tr } = await import(`./words.js${V}`);

/** The lanes' colours, told apart without colour too: each track is named. */
export const ROLL_COLOURS = ["#2f6db5", "#d07a1f", "#3f8f5a", "#9b4fb0", "#c2434b", "#2b9aa0", "#8a6d1f", "#5b6475"];

const RULER_H = 24;
const KEYS_W = 46;
const HEADS_W = 132;
const ROW_H = 11;
// Pixels per quarter note, at zoom 1.
const QUARTER_W = 26;
const TRACK_MIN = 34;
const TRACK_MAX = 96;
const TRACK_ROW = 4;
const KEYS_MIN_ROWS = 25;

const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** The key's name with its octave: 60 is C4. */
export function keyName(key) {
  return `${NAMES[key % 12]}${Math.floor(key / 12) - 1}`;
}

/**
 * Every sounding note of the score: `{ lane, index, last, t0, t1, key }`, a
 * tie chain as one note from its first event (`index`) to its last (`last`),
 * in ticks; a chord gives a note per pitch. Rests and grace notes are left out.
 */
export function rollNotes(score) {
  const out = [];
  score.staves.forEach((staff, lane) => {
    const at = M.starts(staff);
    staff.events.forEach((ev, i) => {
      if (ev.rest) return;
      // Tied on from the event before: drawn with the chain's first event.
      if (i > 0 && staff.events[i - 1].tie && !staff.events[i - 1].rest) return;
      const [, last] = M.tiedNotes(staff, i);
      const t1 = at[last] + M.ticksOf(staff.events[last]);
      for (const p of ev.pitches) {
        const key = p.drum ? M.drumKey(p.drum) : M.midiKey(p.d, p.alter ?? 0);
        out.push({ lane, index: i, last, t0: at[i], t1, key });
      }
    });
  });
  return out;
}

/** The lanes as the tracks name them: the staff's name, its other voices marked. */
export function laneNames(score) {
  return score.staves.map((_, s) => {
    const upper = score.staves[M.upperOf(score, s)];
    const name = upper.name || upper.instrument || tr("Staff {n}", { n: M.staffNumber(score, s) + 1 });
    return M.isLower(score, s) ? tr("{name}, voice {n}", { name, n: M.voiceOf(score, s) }) : name;
  });
}

/** Lane `s`'s colour: a colour per lane, each voice of a staff its own. */
export function laneColour(score, s) {
  return ROLL_COLOURS[s % ROLL_COLOURS.length];
}

/**
 * Where everything goes: `{ layout, width, height, left, x(t), notes,
 * tracks: [{ lane, y, h, low, high, row }] }` — for "keys", one track holding
 * every lane, or lane `only`. Drawing and hit-testing both read it.
 */
export function rollLayout(score, { layout = "tracks", zoom = 1, only = null } = {}) {
  // `only`: one lane on the keyboard, the rest left out.
  const notes = rollNotes(score).filter((n) => only == null || layout !== "keys" || n.lane === only);
  const bars = M.barsOf(score);
  const perTick = (QUARTER_W * zoom * 4) / M.WHOLE;
  const left = layout === "keys" ? KEYS_W : HEADS_W;
  const x = (t) => left + t * perTick;
  const width = Math.ceil(x(M.barStart(score, bars))) + 1;
  const range = (keys) => [(keys.length ? Math.min(...keys) : 60) - 2, (keys.length ? Math.max(...keys) : 67) + 2];
  let tracks;
  if (layout === "keys") {
    // Two octaves at least, the notes in the middle: room to drag one up or down.
    let [low, high] = range(notes.map((n) => n.key));
    const short = KEYS_MIN_ROWS - (high - low + 1);
    if (short > 0) {
      low -= Math.floor(short / 2);
      high += Math.ceil(short / 2);
    }
    tracks = [{ lane: null, y: RULER_H, h: (high - low + 1) * ROW_H, low, high, row: ROW_H }];
  } else {
    let y = RULER_H;
    tracks = score.staves.map((_, lane) => {
      const [low, high] = range(notes.filter((n) => n.lane === lane).map((n) => n.key));
      const h = Math.max(TRACK_MIN, Math.min(TRACK_MAX, (high - low + 1) * TRACK_ROW));
      const track = { lane, y, h, low, high, row: h / (high - low + 1) };
      y += h;
      return track;
    });
  }
  const last = tracks[tracks.length - 1];
  return { layout, width, height: last ? last.y + last.h : RULER_H, left, x, perTick, notes, tracks, bars };
}

/** What lies under a point of the roll (pixels from its top left): `{ bar, lane, note }`, each or null. */
export function rollHit(score, geo, px, py, target = null) {
  const t = Math.max(0, (px - geo.left) / geo.perTick);
  const bar = px < geo.left ? null : Math.min(geo.bars - 1, M.barAt(score, Math.floor(t)));
  const track = geo.tracks.find((row) => py >= row.y && py < row.y + row.h);
  const lane = geo.layout === "tracks" ? (track?.lane ?? null) : null;
  const note = target?.dataset?.lane != null ? { lane: Number(target.dataset.lane), index: Number(target.dataset.index), key: Number(target.dataset.key) } : null;
  return { bar, lane, note, ruler: py < RULER_H };
}

/**
 * The roll as SVG. `options`: `layout`, `zoom`, `sel` (the studio's
 * selection, whose `lanes` a section covers), `lit` (notes being played,
 * "lane:index"), `cursor` (the tick being played, or null).
 */
export function drawRoll(score, { layout = "tracks", zoom = 1, sel = null, lit = new Set(), cursor = null, loop = null, only = null } = {}) {
  const geo = rollLayout(score, { layout, zoom, only });
  const { x, width, height, left } = geo;
  const names = laneNames(score);
  const parts = [];
  for (const track of geo.tracks) {
    const yOf = (key) => track.y + (track.high - key) * track.row;
    if (layout === "keys") {
      for (let key = track.low; key <= track.high; key++) {
        const black = BLACK.has(key % 12);
        parts.push(`<rect class="roll-row${black ? " roll-row-black" : ""}" x="${left}" y="${yOf(key)}" width="${width - left}" height="${track.row}"/>`);
        parts.push(`<rect class="roll-key${black ? " roll-key-black" : ""}" x="0" y="${yOf(key)}" width="${left - 4}" height="${track.row}"/>`);
        if (key % 12 === 0) parts.push(`<text class="roll-key-name" x="${left - 8}" y="${yOf(key) + track.row - 2}" text-anchor="end">${keyName(key)}</text>`);
      }
    } else {
      const odd = M.staffNumber(score, track.lane) % 2 === 1;
      parts.push(`<rect class="roll-track${odd ? " roll-track-odd" : ""}" x="0" y="${track.y}" width="${width}" height="${track.h}"/>`);
      parts.push(`<rect class="roll-swatch" x="8" y="${track.y + 8}" width="10" height="10" rx="3" fill="${laneColour(score, track.lane)}"/>`);
      // A voice's track sits under its staff's: "Voice 3" says it, the staff's name above.
      const label = M.isLower(score, track.lane) ? tr("Voice {n}", { n: M.voiceOf(score, track.lane) }) : trim(names[track.lane], 15);
      parts.push(`<text class="roll-track-name" x="24" y="${track.y + 17}">${escape(label)}<title>${escape(names[track.lane])}</title></text>`);
      parts.push(`<text class="roll-track-range" x="24" y="${track.y + 30}">${keyName(track.low + 2)}–${keyName(track.high - 2)}</text>`);
      parts.push(`<line class="roll-track-edge" x1="0" x2="${width}" y1="${track.y + track.h}" y2="${track.y + track.h}"/>`);
    }
  }
  // The selected section: bars, and in "tracks" the tracks it covers.
  if (sel?.bars) {
    const [a, b] = sel.bars;
    const covered = layout === "tracks" && sel.lanes ? geo.tracks.filter((row) => sel.lanes.includes(row.lane)) : geo.tracks;
    const y0 = Math.min(...covered.map((row) => row.y));
    const y1 = Math.max(...covered.map((row) => row.y + row.h));
    parts.push(`<rect class="roll-band" x="${x(M.barStart(score, a))}" y="${y0}" width="${x(M.barStart(score, b + 1)) - x(M.barStart(score, a))}" height="${y1 - y0}"/>`);
  }
  // Bars: a line, the beats fainter, a number on the ruler.
  for (let bar = 0; bar <= geo.bars; bar++) {
    const bx = x(M.barStart(score, bar));
    parts.push(`<line class="roll-bar-line" x1="${bx}" x2="${bx}" y1="0" y2="${height}"/>`);
    if (bar === geo.bars) break;
    const next = x(M.barStart(score, bar + 1));
    // Counted back from the bar's end: a pickup's beats are its bar's last.
    for (let beat = M.barStart(score, bar + 1) - M.WHOLE / 4; x(beat) > bx + 1; beat -= M.WHOLE / 4) {
      parts.push(`<line class="roll-beat" x1="${x(beat)}" x2="${x(beat)}" y1="${RULER_H}" y2="${height}"/>`);
    }
    parts.push(`<rect class="roll-ruler" data-bar="${bar}" x="${bx}" y="0" width="${next - bx}" height="${RULER_H}"/>`);
    parts.push(`<text class="roll-bar-number" x="${bx + 6}" y="16">${M.barNumber(score, bar)}</text>`);
  }
  // The loop, on the ruler and faintly down every track.
  if (loop) {
    const [lx0, lx1] = [x(M.barStart(score, loop[0])), x(M.barStart(score, loop[1] + 1))];
    parts.push(`<rect class="roll-loop-span" x="${lx0}" y="${RULER_H}" width="${lx1 - lx0}" height="${height - RULER_H}"/>`);
    parts.push(`<rect class="roll-loop" x="${lx0 + 1}" y="3" width="${lx1 - lx0 - 2}" height="${RULER_H - 6}" rx="4"/>`);
  }
  parts.push(`<line class="roll-ruler-edge" x1="0" x2="${width}" y1="${RULER_H}" y2="${RULER_H}"/>`);
  // Notes: the selection outlined, those being played lit.
  const chosen = (n) => {
    if (!sel) return false;
    if (sel.bars) {
      const inLanes = sel.lanes ? sel.lanes.includes(n.lane) : n.lane === sel.staff;
      return inLanes && n.t0 >= M.barStart(score, sel.bars[0]) && n.t0 < M.barStart(score, sel.bars[1] + 1);
    }
    const [t0, t1] = [Math.min(sel.t0, sel.t1), Math.max(sel.t0, sel.t1)];
    return n.lane === sel.staff && n.t0 <= t1 && n.t1 > t0;
  };
  for (const n of geo.notes) {
    const track = layout === "keys" ? geo.tracks[0] : geo.tracks[n.lane];
    const ny = track.y + (track.high - n.key) * track.row;
    const h = Math.max(2, track.row - (layout === "keys" ? 2 : 1));
    const classes = ["roll-note", chosen(n) ? "roll-note-chosen" : "", lit.has(`${n.lane}:${n.index}`) ? "roll-note-lit" : ""].filter(Boolean).join(" ");
    parts.push(`<rect class="${classes}" data-lane="${n.lane}" data-index="${n.index}" data-key="${n.key}" x="${x(n.t0) + 1}" y="${ny + 0.5}" width="${Math.max(3, x(n.t1) - x(n.t0) - 2)}" height="${h}" rx="${Math.min(3, h / 2)}" fill="${laneColour(score, n.lane)}"><title>${tr("{note}, bar {bar}", { note: keyName(n.key), bar: M.barNumber(score, M.barAt(score, n.t0)) })}</title></rect>`);
  }
  if (cursor != null) parts.push(`<line class="roll-cursor" x1="${x(cursor)}" x2="${x(cursor)}" y1="0" y2="${height}"/>`);
  const label = tr("MIDI view: {bars} bars, {notes} notes", { bars: geo.bars, notes: geo.notes.length });
  return `<svg xmlns="http://www.w3.org/2000/svg" class="roll roll-${layout}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">${parts.join("")}</svg>`;
}

function trim(text, n) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function escape(text) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
