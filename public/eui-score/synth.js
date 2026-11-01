// A simple subtractive synthesizer (#391): what a staff can play instead of
// its SoundFont instrument. Two oscillators (sine, square, saw, triangle)
// with their detune, a low-pass filter (cutoff, resonance, and how far the
// envelope opens it), an amplitude envelope (attack, decay, sustain,
// release); four presets to start from: pad, lead, bass, pluck. The filter
// follows the amplitude envelope's shape: one envelope, two destinations.
//
// It is Web Audio nodes, a voice a note, into the staff's mixer strip
// (mixer.js `strip`): its mute, solo, volume, pan and effects act on it as
// on a SoundFont's sound. On Play the staff's notes are taken out of the
// MIDI the synthesizer plays (`stripNotes`) and sounded here instead, a
// little ahead of the music (`Scheduler`, as the metronome's clicks are);
// on Save the sound they are all scheduled on the OfflineAudioContext
// (`scheduleAll`). Save as MIDI keeps the staff's General MIDI program.
//
// Kept with the score, on its `%% eui-score` line, under `synth`, by lane:
//
//   "synth": { "0": { "preset": "pad", "filter": { "cutoff": 0.5 } } }
//
// the preset and what differs from it. No DOM here: tests/js/synth.test.mjs.

const V = new URL(import.meta.url).search;
const F = await import(`./feel.js${V}`);
const Ch = await import(`./channels.js${V}`);
const { tr } = await import(`./words.js${V}`);

export const WAVES = ["sine", "square", "sawtooth", "triangle"];
export const WAVE_NAMES = { sine: tr("Sine"), square: tr("Square"), sawtooth: tr("Saw"), triangle: "Triangle" };

/** The presets, every field there. */
export const PRESETS = {
  pad: {
    name: tr("Pad"),
    osc1: { wave: "sawtooth", detune: -7, octave: 0, level: 0.7 },
    osc2: { wave: "sawtooth", detune: 7, octave: 0, level: 0.7 },
    filter: { cutoff: 0.45, resonance: 0.15, env: 0.2 },
    amp: { attack: 0.6, decay: 0.8, sustain: 0.8, release: 1.5 },
  },
  lead: {
    name: "Lead",
    osc1: { wave: "square", detune: 0, octave: 0, level: 0.7 },
    osc2: { wave: "sawtooth", detune: 5, octave: 0, level: 0.5 },
    filter: { cutoff: 0.6, resonance: 0.35, env: 0.4 },
    amp: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.25 },
  },
  bass: {
    name: tr("Bass"),
    osc1: { wave: "sawtooth", detune: 0, octave: 0, level: 0.8 },
    osc2: { wave: "square", detune: 0, octave: -1, level: 0.6 },
    filter: { cutoff: 0.35, resonance: 0.3, env: 0.5 },
    amp: { attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.1 },
  },
  pluck: {
    name: tr("Pluck"),
    osc1: { wave: "triangle", detune: 0, octave: 0, level: 0.8 },
    osc2: { wave: "sawtooth", detune: 3, octave: 1, level: 0.3 },
    filter: { cutoff: 0.3, resonance: 0.25, env: 0.7 },
    amp: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.3 },
  },
};
export const DEFAULT_PRESET = "pad";

/** Each knob's range. */
export const RANGES = {
  detune: [-100, 100],
  octave: [-2, 2],
  level: [0, 1],
  cutoff: [0, 1],
  resonance: [0, 1],
  env: [-1, 1],
  attack: [0.001, 5],
  decay: [0.001, 5],
  sustain: [0, 1],
  release: [0.005, 8],
};

const clamp = (x, [lo, hi], fallback) => {
  const n = Number(x);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) && x !== "" && x != null ? n : fallback));
};

/** A staff's synthesizer, every field there and in range: `stored` over its preset. */
export function settings(stored = {}) {
  const s = stored ?? {};
  // Own presets only: "constructor" or "toString" on a meta line is no preset (#537).
  const preset = Object.hasOwn(PRESETS, s.preset ?? "") ? s.preset : DEFAULT_PRESET;
  const base = PRESETS[preset];
  const osc = (k) => ({
    wave: WAVES.includes(s[k]?.wave) ? s[k].wave : base[k].wave,
    detune: clamp(s[k]?.detune, RANGES.detune, base[k].detune),
    octave: Math.round(clamp(s[k]?.octave, RANGES.octave, base[k].octave)),
    level: clamp(s[k]?.level, RANGES.level, base[k].level),
  });
  const group = (k) => Object.fromEntries(Object.keys(base[k]).map((f) => [f, clamp(s[k]?.[f], RANGES[f], base[k][f])]));
  return { preset, osc1: osc("osc1"), osc2: osc("osc2"), filter: group("filter"), amp: group("amp") };
}

/** Only the preset and what differs from it: what the text keeps. */
export function compact(full) {
  const base = PRESETS[full.preset];
  const out = { preset: full.preset };
  for (const k of ["osc1", "osc2", "filter", "amp"]) {
    const part = Object.fromEntries(Object.entries(full[k]).filter(([f, v]) => v !== base[k][f]));
    if (Object.keys(part).length) out[k] = part;
  }
  return out;
}

/** True for a staff's lane (a number): an audio track's ("audio-1", #390) plays no synthesizer. */
export const isStaff = (score, lane) => /^\d+$/.test(String(lane)) && Boolean(score?.staves?.[Number(lane)]);

/** Lane `lane`'s synthesizer in full, or null when the staff plays its SoundFont instrument (or it is no staff). */
export function synthOf(score, lane) {
  if (!isStaff(score, lane)) return null;
  const stored = score?.meta?.synth?.[lane];
  return stored ? settings(stored) : null;
}

/** The lanes that play the synthesizer: [lane]. */
export function synthLanes(score) {
  return Object.keys(score?.meta?.synth ?? {}).map(Number).filter((n) => Number.isInteger(n) && score.staves?.[n]);
}

/**
 * The score's synthesizer for lane `lane` changed: `patch` laid over it —
 * a new `preset` starts again from that preset — or taken away with null
 * (the staff plays its SoundFont instrument again). Kept in `score.meta.synth`.
 */
export function setSynth(score, lane, patch) {
  if (!isStaff(score, lane)) return null;
  const all = { ...(score.meta?.synth ?? {}) };
  if (patch == null) delete all[lane];
  else {
    const was = patch.preset ? settings({ preset: patch.preset }) : (synthOf(score, lane) ?? settings());
    const now = { ...was, preset: was.preset };
    for (const k of ["osc1", "osc2", "filter", "amp"]) now[k] = { ...was[k], ...(patch[k] ?? {}) };
    all[lane] = compact(settings(now));
  }
  score.meta = { ...(score.meta ?? {}) };
  if (Object.keys(all).length) score.meta.synth = all;
  else delete score.meta.synth;
  return all[lane] ?? null;
}

// ---- From knobs to sound ----------------------------------------------------------------

/** The cutoff knob (0–1) in Hz: 20 Hz to 20 kHz, evenly by octave. */
export const cutoffHz = (knob) => 20 * 1000 ** Math.max(0, Math.min(1, knob));
/** The resonance knob (0–1) as the filter's Q: 0.7 (none) to 20. */
export const resonanceQ = (knob) => 0.7 + 19.3 * Math.max(0, Math.min(1, knob));
/** How far the envelope moves the cutoff, at full amount: six octaves. */
export const ENV_OCTAVES = 6;
/** A key's frequency, A4 (69) at 440 Hz. */
export const keyHz = (key) => 440 * 2 ** ((key - 69) / 12);

/**
 * What the knobs make of note `key`, struck at `velocity` (1–127): each
 * oscillator's frequency and detune (cents, the octave in it), the
 * filter's resting and peak cutoff (Hz) and Q, the voice's peak gain, the
 * envelope's times.
 */
export function voiceParams(full, key, velocity = 100) {
  const s = settings(full);
  const base = cutoffHz(s.filter.cutoff);
  const peak = Math.max(20, Math.min(20000, base * 2 ** (s.filter.env * ENV_OCTAVES)));
  const osc = (o) => ({ wave: o.wave, hz: keyHz(key), cents: o.detune + 1200 * o.octave, level: o.level });
  return {
    osc: [osc(s.osc1), osc(s.osc2)],
    cutoff: base,
    cutoffPeak: peak,
    cutoffSustain: base + (peak - base) * s.amp.sustain,
    q: resonanceQ(s.filter.resonance),
    // A quarter of full scale at the hardest: room for chords before the master clips.
    gain: 0.25 * (Math.max(1, Math.min(127, velocity)) / 127) ** 1.5,
    ...s.amp,
  };
}

/**
 * A voice on `ctx`, into `destination`: note `key` from audio time `at`.
 * Answers `{ stop(when), bend(semitones, when), pressure(value, when) }`:
 * `stop` starts the release and answers when the sound is over; `bend` and
 * `pressure` (0–127, opening the filter up to an octave) are MPE's per-note
 * expression.
 */
export function voice(ctx, full, destination, { key, velocity = 100, at = ctx.currentTime } = {}) {
  const p = voiceParams(full, key, velocity);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = p.q;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  filter.connect(amp);
  amp.connect(destination);
  const oscs = p.osc.map((o) => {
    const osc = ctx.createOscillator();
    osc.type = o.wave;
    osc.frequency.value = o.hz;
    osc.detune.value = o.cents;
    const level = ctx.createGain();
    level.gain.value = o.level;
    osc.connect(level);
    level.connect(filter);
    osc.start(at);
    return { osc, cents: o.cents };
  });
  // Attack to the peak, decay to the sustain: the gain and the cutoff alike.
  const t1 = at + p.attack;
  const t2 = t1 + p.decay;
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(p.gain, t1);
  amp.gain.setTargetAtTime(p.gain * p.sustain, t1, p.decay / 4);
  filter.frequency.setValueAtTime(p.cutoff, at);
  filter.frequency.linearRampToValueAtTime(p.cutoffPeak, t1);
  filter.frequency.setTargetAtTime(p.cutoffSustain, t1, p.decay / 4);
  let ended = null;
  return {
    key,
    nodes: { filter, amp, oscs: oscs.map((o) => o.osc) },
    stop(when = ctx.currentTime) {
      if (ended != null) return ended;
      const from = Math.max(when, at);
      amp.gain.cancelScheduledValues(from);
      filter.frequency.cancelScheduledValues(from);
      // Released before the attack is over: from where the attack got to.
      const reached = from < t1 ? p.gain * ((from - at) / Math.max(1e-6, p.attack)) : from < t2 ? p.gain : p.gain * p.sustain;
      amp.gain.setValueAtTime(reached, from);
      amp.gain.setTargetAtTime(0, from, p.release / 5);
      filter.frequency.setTargetAtTime(p.cutoff, from, p.release / 5);
      ended = from + p.release;
      for (const { osc } of oscs) osc.stop(ended + 0.05);
      return ended;
    },
    bend(semitones, when = ctx.currentTime) {
      for (const { osc, cents } of oscs) osc.detune.setTargetAtTime(cents + 100 * semitones, when, 0.005);
    },
    pressure(value, when = ctx.currentTime) {
      const open = 2 ** (Math.max(0, Math.min(127, value)) / 127);
      filter.frequency.setTargetAtTime(Math.min(20000, p.cutoffSustain * open), when, 0.02);
    },
  };
}

// ---- The notes, from the MIDI -----------------------------------------------------------

const kindOf = (data) => data[0] & 0xf0;
const isOn = (data) => kindOf(data) === 0x90 && data[2] > 0;
const isOff = (data) => kindOf(data) === 0x80 || (kindOf(data) === 0x90 && data[2] === 0);

/** Ticks to seconds for `smf` (readSmf's): its tempo events, from every track. */
export function clockOf(smf) {
  const tempos = smf.tracks
    .flatMap((events) => events.filter((e) => e.data[0] === 0xff && e.data[1] === 0x51))
    .map((e) => ({ tick: e.tick, us: (e.data[3] << 16) | (e.data[4] << 8) | e.data[5] }))
    .sort((a, b) => a.tick - b.tick);
  const marks = [{ tick: 0, sec: 0, us: 500000 }];
  for (const t of tempos) {
    const last = marks.at(-1);
    const sec = last.sec + ((t.tick - last.tick) * last.us) / 1e6 / smf.division;
    if (t.tick === last.tick) last.us = t.us;
    else marks.push({ tick: t.tick, sec, us: t.us });
  }
  return (tick) => {
    let k = marks.length - 1;
    while (k > 0 && marks[k].tick > tick) k--;
    const m = marks[k];
    return m.sec + ((tick - m.tick) * m.us) / 1e6 / smf.division;
  };
}

/**
 * The notes of `bytes` on the synthesizer channels in `channels` (a Set;
 * a channel is port × 16 + the file's): [{ channel, key, velocity, on,
 * off }], in seconds, by start.
 */
export function notesOf(bytes, channels) {
  if (!channels.size) return [];
  const smf = F.readSmf(bytes);
  const sec = clockOf(smf);
  const out = [];
  for (const events of smf.tracks) {
    const port = Ch.portOf(events);
    const open = new Map();
    for (const e of events) {
      if (e.data[0] >= 0xf0) continue;
      const channel = 16 * port + (e.data[0] & 15);
      if (!channels.has(channel)) continue;
      const id = `${channel}:${e.data[1]}`;
      if (isOn(e.data)) {
        if (!open.has(id)) open.set(id, []);
        open.get(id).push({ channel, key: e.data[1], velocity: e.data[2], on: sec(e.tick), off: null });
      } else if (isOff(e.data)) {
        const note = open.get(id)?.shift();
        if (note) out.push({ ...note, off: Math.max(note.on + 0.01, sec(e.tick)) });
      }
    }
    for (const left of open.values()) for (const note of left) out.push({ ...note, off: note.on + 1 });
  }
  return out.sort((a, b) => a.on - b.on || a.key - b.key);
}

/** `bytes` without the notes (and their key pressure) on the channels in `channels`: the SoundFont leaves them to this synthesizer. */
export function stripNotes(bytes, channels) {
  if (!channels.size) return bytes;
  const smf = F.readSmf(bytes);
  for (const events of smf.tracks) {
    const port = Ch.portOf(events);
    const kept = events.filter((e) => !(e.data[0] < 0xf0 && [0x80, 0x90, 0xa0].includes(kindOf(e.data)) && channels.has(16 * port + (e.data[0] & 15))));
    events.splice(0, events.length, ...kept);
  }
  return F.writeSmf(smf);
}

/**
 * Every note of `notes` scheduled at once on `ctx` (an OfflineAudioContext:
 * Save the sound), from `offset` seconds: `settingsOf(channel)` its
 * synthesizer, `destinationOf(channel)` where it goes. Answers the voices.
 */
export function scheduleAll(ctx, notes, settingsOf, destinationOf, offset = 0) {
  return notes.map((n) => {
    const v = voice(ctx, settingsOf(n.channel), destinationOf(n.channel), { key: n.key, velocity: n.velocity, at: offset + n.on });
    v.stop(offset + n.off);
    return v;
  });
}

/**
 * The notes sounded while a piece plays, a little ahead of it: `tick(now,
 * rate)` each few milliseconds with the piece's time (seconds, as the
 * sequencer counts them) schedules the notes starting in the next
 * `ahead` seconds against the audio clock; a jump — a seek, the loop —
 * lets the voices go and starts again where the music is. `silence()` on
 * a pause or a stop.
 */
export class Scheduler {
  constructor({ ctx, notes, settingsOf, destinationOf, ahead = 0.12 }) {
    Object.assign(this, { ctx, notes, settingsOf, destinationOf, ahead });
    this.next = 0;
    this.last = null;
    this.voices = new Set();
  }

  tick(now, rate = 1) {
    const jumped = this.last != null && (now < this.last - 0.05 || now > this.last + 0.5);
    if (this.last == null || jumped) {
      if (jumped) this.silence();
      this.next = this.notes.findIndex((n) => n.on >= now - 0.01);
      if (this.next < 0) this.next = this.notes.length;
    }
    this.last = now;
    const audio = this.ctx.currentTime;
    while (this.next < this.notes.length && this.notes[this.next].on < now + this.ahead * rate) {
      const n = this.notes[this.next++];
      const at = audio + Math.max(0, n.on - now) / rate;
      const v = voice(this.ctx, this.settingsOf(n.channel), this.destinationOf(n.channel), { key: n.key, velocity: n.velocity, at });
      const end = v.stop(at + (n.off - n.on) / rate);
      this.voices.add(v);
      v.end = end;
    }
    for (const v of this.voices) if (v.end < audio) this.voices.delete(v);
  }

  silence() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      v.nodes.amp.gain.cancelScheduledValues(now);
      v.nodes.amp.gain.setTargetAtTime(0, now, 0.01);
      for (const osc of v.nodes.oscs) {
        try {
          osc.stop(now + 0.06);
        } catch (error) {}
      }
    }
    this.voices.clear();
    this.last = null;
  }
}

/**
 * The keys played live on a staff that plays this synthesizer (a MIDI
 * keyboard while recording, a note written): `on(channel, key, velocity)`,
 * `off(channel, key)`, and MPE's per-note `expression(key, { bend,
 * pressure })`. `context()` answers the AudioContext, `settingsOf(channel)`
 * the staff's synthesizer or null (then the SoundFont plays it),
 * `destinationOf(channel)` where it goes.
 */
export function liveKeys({ context, settingsOf, destinationOf }) {
  const held = new Map();
  return {
    on(channel, key, velocity = 100) {
      const s = settingsOf(channel);
      if (!s) return false;
      const ctx = context();
      held.get(key)?.stop(ctx.currentTime);
      held.set(key, voice(ctx, s, destinationOf(channel), { key, velocity, at: ctx.currentTime }));
      return true;
    },
    off(channel, key) {
      const v = held.get(key);
      if (!v) return Boolean(settingsOf(channel));
      held.delete(key);
      v.stop(context().currentTime);
      return true;
    },
    expression(key, { bend = null, pressure = null } = {}) {
      const v = held.get(key);
      if (!v) return false;
      if (bend != null) v.bend(bend);
      if (pressure != null) v.pressure(pressure);
      return true;
    },
    get held() {
      return [...held.keys()];
    },
  };
}
