// A Standard MIDI File (.mid) read as a score, in the browser: its tracks
// become staves, their programs instruments, channel 10 a drum kit; the
// notes are fitted to a grid as a recording is (score-model.js
// `writeRecording`), so the score reads as written music, not as a list of
// milliseconds.
//
//   parseMidi(bytes)              → { format, division, tracks }   the file, as it is
//   fromMidi(bytes, { title, grid }) → { source, score, warnings } the score, as LilyPond
//   isMidi(name)                  → whether a file's name is a MIDI one
//
// Nothing leaves the page. What a file holds that the score does not keep
// (pitch bends, the sustain pedal, tempo changes after the first…) is left
// out, and each such thing is named once in `warnings`. Fetched only when a
// MIDI file is opened.

const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);

/** The most staves an imported score is given; the tracks after them are left out, and named. */
export const MAX_STAVES = 16;
/** The most bars an imported score is given, as a new score has (see `fromTemplate`). */
export const MAX_BARS = 500;
/** General MIDI's drum channel: channel 10, counted from 0. */
const DRUM_CHANNEL = 9;

// ---- Reading the file ------------------------------------------------------------

/** Refuses a file that is not what it says, with a sentence a person can read. */
function refuse(reason) {
  throw new Error(`This is not a MIDI file that can be read: ${reason}.`);
}

/**
 * The file's chunks read as they are: { format, division, tracks }, each
 * track { events }, an event { tick, kind, … } where `kind` is "on", "off",
 * "program", "controller", "bend", "pressure", "meta" or "sysex", and
 * `tick` counts from the track's start in the file's own ticks (`division`
 * to a quarter). Throws on anything that is not a Standard MIDI File.
 */
export function parseMidi(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const text = (at, n) => String.fromCharCode(...bytes.subarray(at, at + n));
  const u32 = (at) => ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
  const u16 = (at) => (bytes[at] << 8) | bytes[at + 1];
  if (bytes.length < 14 || text(0, 4) !== "MThd") refuse("it does not start as one (MThd)");
  const headerLength = u32(4);
  if (headerLength < 6 || 8 + headerLength > bytes.length) refuse("its header is cut short");
  const format = u16(8);
  const count = u16(10);
  const division = u16(12);
  if (format > 2) refuse(`format ${format} is not a MIDI format`);
  if (format === 2) refuse("it is format 2, a set of separate patterns, which no score is written from");
  if (division & 0x8000) refuse("its times are in SMPTE frames, not in beats");
  if (division === 0) refuse("it counts no ticks to a beat");
  const tracks = [];
  let at = 8 + headerLength;
  while (tracks.length < count && at + 8 <= bytes.length) {
    const id = text(at, 4);
    const length = u32(at + 4);
    const start = at + 8;
    const end = start + length;
    if (end > bytes.length) refuse(`track ${tracks.length + 1} is cut short`);
    // Chunks of other kinds are passed over, as the standard says.
    if (id === "MTrk") tracks.push({ events: readTrack(bytes, start, end, tracks.length + 1) });
    at = end;
  }
  if (!tracks.length) refuse("it holds no track");
  return { format, division, tracks };
}

/** One track's events, from `start` to `end`. */
function readTrack(bytes, start, end, number) {
  const events = [];
  let at = start;
  let tick = 0;
  let running = 0;
  const byte = () => {
    if (at >= end) refuse(`track ${number} ends inside an event`);
    return bytes[at++];
  };
  const varLength = () => {
    let value = 0;
    for (let k = 0; k < 4; k++) {
      const b = byte();
      value = value * 128 + (b & 127);
      if (!(b & 128)) return value;
    }
    refuse(`track ${number} holds a number longer than MIDI allows`);
  };
  while (at < end) {
    tick += varLength();
    let status = bytes[at];
    if (status & 0x80) at++;
    else if (running) status = running;
    else refuse(`track ${number} holds data where an event should start`);
    if (status === 0xff) {
      const type = byte();
      const length = varLength();
      if (at + length > end) refuse(`track ${number} ends inside an event`);
      events.push({ tick, kind: "meta", type, data: bytes.subarray(at, at + length) });
      at += length;
      if (type === 0x2f) break;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const length = varLength();
      at += length;
      if (at > end) refuse(`track ${number} ends inside an event`);
      events.push({ tick, kind: "sysex" });
      continue;
    }
    if (status >= 0xf0) refuse(`track ${number} holds an event no file may hold (${status.toString(16)})`);
    running = status;
    const channel = status & 15;
    const a = byte();
    switch (status & 0xf0) {
      case 0x80: byte(); events.push({ tick, kind: "off", channel, key: a }); break;
      case 0x90: {
        const velocity = byte();
        events.push(velocity ? { tick, kind: "on", channel, key: a, velocity } : { tick, kind: "off", channel, key: a });
        break;
      }
      case 0xa0: byte(); events.push({ tick, kind: "pressure", channel }); break;
      case 0xb0: events.push({ tick, kind: "controller", channel, controller: a, value: byte() }); break;
      case 0xc0: events.push({ tick, kind: "program", channel, program: a }); break;
      case 0xd0: events.push({ tick, kind: "pressure", channel }); break;
      default: {
        const b = byte();
        // A bend away from the middle; the centre itself bends nothing.
        if (a !== 0 || b !== 64) events.push({ tick, kind: "bend", channel });
      }
    }
  }
  return events;
}

// ---- The score ------------------------------------------------------------------

const textOf = (data) => new TextDecoder("latin1").decode(data).replace(/\0+$/, "").trim();

/** A part of the music: a track's notes on one channel. */
function partsOf(midi, warnings) {
  const parts = [];
  midi.tracks.forEach((track, t) => {
    const name = textOf(track.events.find((e) => e.kind === "meta" && e.type === 0x03)?.data ?? new Uint8Array());
    const byChannel = new Map();
    const programs = new Map();
    const open = new Map();
    for (const e of track.events) {
      if (e.kind === "program" && !programs.has(e.channel)) programs.set(e.channel, { program: e.program, tick: e.tick });
      if (e.kind === "bend") warnings.add("pitch bends");
      if (e.kind === "controller" && e.controller === 64) warnings.add("the sustain pedal");
      if (e.kind !== "on" && e.kind !== "off") continue;
      const id = `${e.channel}:${e.key}`;
      if (e.kind === "on") {
        if (!open.has(id)) open.set(id, []);
        open.get(id).push(e);
        continue;
      }
      const started = open.get(id)?.shift();
      if (!started) continue;
      if (!byChannel.has(e.channel)) byChannel.set(e.channel, []);
      byChannel.get(e.channel).push({ key: e.key, t0: started.tick, t1: e.tick, velocity: started.velocity });
    }
    // A note never released lasts to the track's end.
    const last = track.events.length ? track.events[track.events.length - 1].tick : 0;
    for (const [id, waiting] of open) {
      const channel = Number(id.split(":")[0]);
      for (const e of waiting) {
        if (!byChannel.has(channel)) byChannel.set(channel, []);
        byChannel.get(channel).push({ key: e.key, t0: e.tick, t1: Math.max(last, e.tick + 1), velocity: e.velocity });
      }
    }
    for (const [channel, notes] of [...byChannel].sort((x, y) => x[0] - y[0])) {
      // Program changes across the music: the first one keeps its sound.
      const changes = new Set(track.events.filter((e) => e.kind === "program" && e.channel === channel).map((e) => e.program));
      if (changes.size > 1) warnings.add("instrument changes in a track, its first instrument kept");
      parts.push({ track: t, channel, name, program: programs.get(channel)?.program ?? 0, notes: notes.sort((x, y) => x.t0 - y.t0 || x.key - y.key) });
    }
  });
  return parts;
}

/** The first meta event of `type` across the tracks, and whether others follow it later. */
function firstMeta(midi, type) {
  const all = midi.tracks.flatMap((track) => track.events.filter((e) => e.kind === "meta" && e.type === type)).sort((x, y) => x.tick - y.tick);
  return { first: all[0] ?? null, later: all.some((e) => e.tick > 0 && (!all[0] || e.data.join() !== all[0].data.join())) };
}

/** A program's staff: one of INSTRUMENTS that sounds it, else its General MIDI name. */
function instrumentFor(program) {
  const sound = M.PROGRAMS[program] ?? "acoustic grand";
  const it = M.INSTRUMENTS.find((x) => x.sound === sound);
  return it ? { name: it.name, short: it.short, sound, clef: it.clef } : { name: sound[0].toUpperCase() + sound.slice(1), short: "", sound, clef: null };
}

/**
 * The file as a score: { source, score, warnings }. `title` names a score
 * whose file names none; `grid` is one of RECORDING_GRIDS (sixteenths when
 * not said). Throws, with a sentence a person can read, on a file that is
 * not a MIDI file or holds no note.
 */
export function fromMidi(bytes, { title = "", grid = "sixteenth" } = {}) {
  const midi = parseMidi(bytes);
  const warnings = new Set();
  const step = M.RECORDING_GRIDS[grid] ?? M.RECORDING_GRIDS.sixteenth;
  // The file's ticks in the model's: `division` of them to a quarter.
  const scale = M.WHOLE / 4 / midi.division;

  const tempo = firstMeta(midi, 0x51);
  // A file that sets no tempo plays at 120 a quarter, as MIDI says.
  const bpm = tempo.first && tempo.first.data.length >= 3 ? Math.round(60e6 / ((tempo.first.data[0] << 16) | (tempo.first.data[1] << 8) | tempo.first.data[2])) : 120;
  if (tempo.later) warnings.add("tempo changes, the first tempo kept");
  const metre = firstMeta(midi, 0x58);
  let time = [4, 4];
  if (metre.first && metre.first.data.length >= 2) {
    const [n, power] = metre.first.data;
    if (n >= 1 && n <= 32 && power <= 6) time = [n, 2 ** power];
    else warnings.add("a metre this editor does not write, read as 4/4");
  }
  if (metre.later) warnings.add("metre changes, the first metre kept");
  const signature = firstMeta(midi, 0x59);
  const fifths = signature.first ? ((signature.first.data[0] << 24) >> 24) : 0;
  if (signature.later) warnings.add("key changes, the first key kept");

  let parts = partsOf(midi, warnings);
  if (!parts.length) throw new Error("This MIDI file holds no note to write.");
  // The first track's name is the piece's, when the track holds no note itself (format 1's tempo track).
  const named = midi.format === 1 && !parts.some((p) => p.track === 0) ? textOf(midi.tracks[0].events.find((e) => e.kind === "meta" && e.type === 0x03)?.data ?? new Uint8Array()) : "";

  const score = {
    header: { title: named || title || "Untitled", composer: "" },
    key: Math.max(-7, Math.min(7, fifths)),
    time,
    tempo: { text: "", base: 4, bpm: Math.max(20, Math.min(300, bpm)) },
    group: "none",
    groups: [],
    staves: [],
    repeats: [],
    changes: [],
  };
  if (parts.every((p) => p.channel === DRUM_CHANNEL)) score.key = 0;

  // Where the music ends once fitted to the grid: a note let go a little late does not add a bar.
  const end = Math.max(...M.quantize(parts.flatMap((p) => p.notes.map((n) => ({ t0: n.t0 * scale, t1: n.t1 * scale }))), step).map((n) => n.t1));
  const limit = M.barStart(score, MAX_BARS);
  if (end > limit) warnings.add(`the music after bar ${MAX_BARS}`);
  const total = Math.max(M.barStart(score, 1), Math.min(limit, end));

  // Each part a staff, or two in a brace for a keyboard whose notes go far both sides of middle C.
  const lanes = [];
  for (const part of parts) {
    const notes = part.notes.map((n) => ({ key: n.key, t0: n.t0 * scale, t1: n.t1 * scale, velocity: n.velocity })).filter((n) => n.t0 < limit);
    if (part.channel === DRUM_CHANNEL) {
      if (notes.some((n) => !M.drumByKey(n.key))) warnings.add("drums this editor does not name, left out");
      lanes.push({ staff: { name: part.name || "Drum kit", short: "Dr.", instrument: "", clef: "percussion", drums: true, events: [] }, notes });
      continue;
    }
    const it = instrumentFor(part.program);
    const name = part.name || it.name;
    const low = notes.filter((n) => n.key < 60);
    const high = notes.filter((n) => n.key >= 60);
    const wide = !it.clef && low.some((n) => n.key < 53) && high.some((n) => n.key > 67);
    if (wide) {
      lanes.push({ staff: { name: "", short: "", instrument: it.sound, clef: "treble", events: [] }, notes: high, brace: { name, short: it.short } });
      lanes.push({ staff: { name: "", short: "", instrument: it.sound, clef: "bass", events: [] }, notes: low });
      continue;
    }
    const average = notes.reduce((sum, n) => sum + n.key, 0) / Math.max(1, notes.length);
    const clef = it.clef ?? (average < 57 ? "bass" : "treble");
    lanes.push({ staff: { name, short: it.short, instrument: it.sound, clef, events: [] }, notes });
  }
  // A brace split across the limit is not left with one staff.
  let kept = lanes.length;
  if (kept > MAX_STAVES) {
    kept = MAX_STAVES - (lanes[MAX_STAVES - 1].brace ? 1 : 0);
    warnings.add(`${lanes.length - kept} ${lanes.length - kept === 1 ? "staff" : "staves"} after the first ${kept}`);
  }
  lanes.slice(0, kept).forEach((lane) => score.staves.push(lane.staff));
  // One staff alone is not named; a brace is named only among other staves.
  if (score.staves.length === 1) Object.assign(score.staves[0], { name: "", short: "" });
  lanes.slice(0, kept).forEach((lane, s) => {
    if (lane.brace) score.groups.push({ kind: "brace", first: s, last: s + 1, name: kept > 2 ? lane.brace.name : "", short: kept > 2 ? lane.brace.short : "" });
  });
  M.ensureLength(score, total);
  const length = M.lengthOf(score.staves[0]);
  lanes.slice(0, kept).forEach((lane, s) => M.writeRecording(score, s, 0, length, lane.notes, step));
  return { source: M.toLilyPond(score).source, score, warnings: [...warnings] };
}

/** Whether a file's name is a MIDI one. */
export function isMidi(name) {
  return /\.(mid|midi|smf|kar)$/i.test(name ?? "");
}
