// The mixer: each staff's volume, pan, mute and solo, a master, and the
// effects — a reverb, a three-band EQ and a compressor — on every track and
// on the master, each with its bypass.
//
// How it is wired. SpessaSynth's worklet has 17 stereo outputs: output 0
// carries its own reverb and chorus (the General MIDI effects bus), outputs
// 1–16 each MIDI channel dry (`synth.connectChannel(node, channel)`). A
// staff plays on a channel of its own (score-model.js `channels`), so each
// channel's output goes through a strip of Web Audio nodes:
//
//   channel → EQ (low shelf, peak, high shelf) → compressor ⇄ bypass
//           → reverb (a convolver, its send) → volume → pan ─┐
//   effects bus (output 0) ──────────────────────────────────┤
//                                                  master strip → meter → speakers
//
// This rather than MIDI CC7/CC10: a piece may set its own volume and pan
// with controllers, and the effects need the sound itself. The same graph
// is built on the OfflineAudioContext that renders "Save the sound", so
// the WAV is mixed as Play is. Mute and solo also mute the channel in the
// synthesizer (player.js `mute`), which silences its share of the effects
// bus; a track's volume does not reach that bus (a faint General MIDI reverb
// of a quiet track stays).
//
// The settings are the score's, in its text (`%% eui-score {"mixer": …}`):
//
//   { "master": { "volume": -3, "reverb": { "on": true, "room": "hall", "mix": 0.3 } },
//     "tracks": { "0": { "volume": -6, "pan": -0.4, "mute": true, "eq": { "on": true, "low": 3 } } } }
//
// keyed by the staff's lane; only what differs from the defaults is kept.
// No DOM here: tests/js/mixer.test.mjs runs it against a fake AudioContext.

/** The rooms the reverb can be: made, not loaded — a few seconds of shaped noise each. */
export const ROOMS = {
  room: { name: "Room", seconds: 0.7, damping: 0.25, pre: 0.004 },
  chamber: { name: "Chamber", seconds: 1.4, damping: 0.4, pre: 0.012 },
  hall: { name: "Hall", seconds: 2.6, damping: 0.55, pre: 0.022 },
  cathedral: { name: "Cathedral", seconds: 4.5, damping: 0.65, pre: 0.035 },
};

/** The EQ's three bands: where they sit, and how far a band goes either way (dB). */
export const EQ_BANDS = { low: 200, mid: 1000, high: 5000 };
export const EQ_RANGE = 12;
/** The faders' range, in dB: at the bottom, silence. */
export const VOLUME_MIN = -60;
export const VOLUME_MAX = 6;

const DEFAULT = {
  volume: 0,
  pan: 0,
  mute: false,
  solo: false,
  eq: { on: false, low: 0, mid: 0, high: 0 },
  comp: { on: false, threshold: -24, ratio: 4 },
  reverb: { on: false, room: "hall", mix: 0.25 },
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(x)) ? Number(x) : lo));

/** A track's or the master's settings, every field there: `stored` over the defaults, each in range. */
export function settings(stored = {}) {
  const s = stored ?? {};
  return {
    volume: clamp(s.volume ?? 0, VOLUME_MIN, VOLUME_MAX),
    pan: clamp(s.pan ?? 0, -1, 1),
    mute: Boolean(s.mute),
    solo: Boolean(s.solo),
    eq: {
      on: Boolean(s.eq?.on),
      low: clamp(s.eq?.low ?? 0, -EQ_RANGE, EQ_RANGE),
      mid: clamp(s.eq?.mid ?? 0, -EQ_RANGE, EQ_RANGE),
      high: clamp(s.eq?.high ?? 0, -EQ_RANGE, EQ_RANGE),
    },
    comp: { on: Boolean(s.comp?.on), threshold: clamp(s.comp?.threshold ?? -24, -60, 0), ratio: clamp(s.comp?.ratio ?? 4, 1, 20) },
    reverb: { on: Boolean(s.reverb?.on), room: Object.hasOwn(ROOMS, s.reverb?.room ?? "") ? s.reverb.room : DEFAULT.reverb.room, mix: clamp(s.reverb?.mix ?? 0.25, 0, 1) },
  };
}

/** Only what differs from the defaults: what the text keeps. Null when nothing does. */
function compact(full) {
  const out = {};
  for (const [key, value] of Object.entries(full)) {
    if (value && typeof value === "object") {
      const part = Object.fromEntries(Object.entries(value).filter(([k, v]) => v !== DEFAULT[key][k]));
      if (Object.keys(part).length) out[key] = part;
    } else if (value !== DEFAULT[key]) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** The score's mixer, as kept: `{ master, tracks }`, either missing. */
export function mixOf(score) {
  return score?.meta?.mixer ?? {};
}

/** Lane `lane`'s settings in full. */
export function trackOf(mix, lane) {
  return settings(mix?.tracks?.[lane]);
}

/** The master's settings in full (its pan, mute and solo unused). */
export function masterOf(mix) {
  return settings(mix?.master);
}

/**
 * The mixer with `patch` laid over a track (`lane`, a number) or the master
 * (`"master"`): a new object, only what differs from the defaults kept;
 * null when nothing does. Effects merge field by field.
 */
export function patched(mix, lane, patch) {
  const master = lane === "master";
  const was = master ? masterOf(mix) : trackOf(mix, lane);
  const now = { ...was, ...patch };
  for (const fx of ["eq", "comp", "reverb"]) now[fx] = { ...was[fx], ...(patch[fx] ?? {}) };
  const kept = compact(settings(now));
  const out = { master: mix?.master ? { ...mix.master } : undefined, tracks: { ...(mix?.tracks ?? {}) } };
  if (master) out.master = kept ?? undefined;
  else if (kept) out.tracks[lane] = kept;
  else delete out.tracks[lane];
  if (!out.master) delete out.master;
  if (!Object.keys(out.tracks).length) delete out.tracks;
  return Object.keys(out).length ? out : null;
}

/** The score's mixer changed so: kept in `score.meta.mixer` (gone when it is all defaults). */
export function setMix(score, lane, patch) {
  const mix = patched(mixOf(score), lane, patch);
  score.meta = { ...(score.meta ?? {}) };
  if (mix) score.meta.mixer = mix;
  else delete score.meta.mixer;
  return mix;
}

/** The lanes muted, or soloed (`field`): [lane] — a staff's a number, an audio track's its name ("audio-1", #390). */
export function lanesWith(mix, field) {
  return Object.entries(mix?.tracks ?? {})
    .filter(([, t]) => t?.[field])
    .map(([lane]) => (/^\d+$/.test(lane) ? Number(lane) : lane));
}

/** True when lane `lane` sounds: not muted, and soloed when any track is. */
export function audible(mix, lane) {
  const solo = lanesWith(mix, "solo");
  return !trackOf(mix, lane).mute && (solo.length === 0 || solo.includes(lane));
}

/** A fader's dB as a gain: the bottom of its travel is silence. */
export function dbToGain(db) {
  return db <= VOLUME_MIN ? 0 : 10 ** (db / 20);
}

/**
 * What each of the 16 MIDI channels plays through: `channels` is
 * score-model.js `channels(score)` (`[{ lane, channel }]`); a channel no
 * staff has (the metronome's, the notes heard while writing) as it is.
 */
export function channelSettings(mix, channels) {
  const out = Array.from({ length: 16 }, () => ({ ...settings(), gain: 1 }));
  for (const [strip, lanes] of stripLanes(channels)) {
    // Two staves through one strip (a second port's channel, #389): theirs
    // when they are alike, else left flat — fileMixLanes puts their volume
    // and pan in the MIDI, and the synthesizer mutes each.
    const alike = stripOf(mix, lanes);
    if (alike) out[strip] = alike;
  }
  return out;
}

/** The settings of a strip carrying `lanes`: theirs when they are all alike, else null. */
function stripOf(mix, lanes) {
  const each = lanes.map((lane) => {
    const s = trackOf(mix, lane);
    return { ...s, gain: audible(mix, lane) ? dbToGain(s.volume) : 0 };
  });
  return each.every((s) => JSON.stringify(s) === JSON.stringify(each[0])) ? each[0] : null;
}

/**
 * The staves each of the 16 strips carries: SpessaSynth renders channel n
 * on output n mod 16, so a second MIDI port's channel 16 + n goes through
 * strip n with channel n. Map strip → [lane].
 */
function stripLanes(channels) {
  const out = new Map();
  for (const { lane, channel } of channels ?? []) {
    if (channel < 0) continue;
    if (!out.has(channel % 16)) out.set(channel % 16, []);
    out.get(channel % 16).push(lane);
  }
  return out;
}

/**
 * The staves whose volume and pan go in the MIDI as CC 7 and CC 10 on Play
 * (automation.js `mixLanes`): those on a strip `channelSettings` leaves
 * flat, unlike the other staff it carries. Empty up to fifteen channels.
 */
export function fileMixLanes(mix, channels) {
  const out = [];
  for (const lanes of stripLanes(channels).values()) if (!stripOf(mix, lanes)) out.push(...lanes);
  return out.sort((a, b) => a - b);
}

// ---- The reverb's rooms -------------------------------------------------------------

/** The same noise each time: a room sounds alike from one Play to the next, and tests can count on it. */
function noise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/**
 * Room `room`'s impulse response, two channels of `rate` samples a second:
 * a short silence, then noise dying away exponentially (to -60 dB at its
 * end), darker as it goes — the more `damping`, the darker.
 */
export function impulseSamples(room, rate) {
  const r = Object.hasOwn(ROOMS, room ?? "") ? ROOMS[room] : ROOMS.hall;
  const length = Math.max(1, Math.round(r.seconds * rate));
  const pre = Math.round(r.pre * rate);
  return [1, 2].map((side) => {
    const next = noise(side * 7919 + Math.round(r.seconds * 1000));
    const out = new Float32Array(length);
    let low = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / (length - pre);
      // A one-pole low-pass closing as the sound dies: high frequencies die first.
      const k = 1 - r.damping * t;
      low += k * (next() - low);
      out[i] = low * Math.exp(-6.9 * t);
    }
    return out;
  });
}

const rooms = new WeakMap();

/** Room `room` as an AudioBuffer of `ctx`, made once per context. */
export function impulse(ctx, room) {
  let made = rooms.get(ctx);
  if (!made) rooms.set(ctx, (made = new Map()));
  if (!made.has(room)) {
    const [left, right] = impulseSamples(room, ctx.sampleRate);
    const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
    buffer.getChannelData(0).set(left);
    buffer.getChannelData(1).set(right);
    made.set(room, buffer);
  }
  return made.get(room);
}

// ---- The audio graph ----------------------------------------------------------------

/**
 * One track's nodes (or the master's): `input` and `output`, and `apply(s)`
 * for its settings. Bypassed, the EQ is flat, the compressor's path is shut
 * and the dry one open, the reverb's send is shut — so a change never
 * reconnects anything while it plays. The convolver is made the first time
 * the reverb is turned on.
 */
export function strip(ctx, { pan = true } = {}) {
  const gain = (value = 1) => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };
  const band = (type, frequency) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.gain.value = 0;
    return node;
  };
  const input = gain();
  const low = band("lowshelf", EQ_BANDS.low);
  const mid = band("peaking", EQ_BANDS.mid);
  mid.Q.value = 0.9;
  const high = band("highshelf", EQ_BANDS.high);
  const comp = ctx.createDynamicsCompressor();
  const compWet = gain(0);
  const compDry = gain(1);
  const post = gain();
  const send = gain(0);
  const volume = gain();
  const panner = pan ? ctx.createStereoPanner() : null;
  const output = panner ?? volume;
  input.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(comp);
  comp.connect(compWet);
  high.connect(compDry);
  compWet.connect(post);
  compDry.connect(post);
  post.connect(volume);
  post.connect(send);
  if (panner) volume.connect(panner);
  let convolver = null;
  let room = null;
  const nodes = { input, low, mid, high, comp, compWet, compDry, post, send, volume, panner, output };
  return {
    input,
    output,
    nodes,
    get convolver() {
      return convolver;
    },
    apply(s, gainValue = dbToGain(s.volume)) {
      low.gain.value = s.eq.on ? s.eq.low : 0;
      mid.gain.value = s.eq.on ? s.eq.mid : 0;
      high.gain.value = s.eq.on ? s.eq.high : 0;
      comp.threshold.value = s.comp.threshold;
      comp.ratio.value = s.comp.ratio;
      compWet.gain.value = s.comp.on ? 1 : 0;
      compDry.gain.value = s.comp.on ? 0 : 1;
      if (s.reverb.on && !convolver) {
        convolver = ctx.createConvolver();
        send.connect(convolver);
        convolver.connect(volume);
      }
      if (convolver && room !== s.reverb.room) {
        convolver.buffer = impulse(ctx, s.reverb.room);
        room = s.reverb.room;
      }
      send.gain.value = s.reverb.on ? s.reverb.mix : 0;
      volume.gain.value = gainValue;
      if (panner) panner.pan.value = s.pan;
    },
  };
}

/**
 * The mixer's graph on `ctx` for SpessaSynth `synth`: a strip per MIDI
 * channel, the effects bus and the strips into the master, the master
 * through a meter to `destination`. `apply(mix, channels)` sets it all;
 * `level()` reads the meter (`{ peak }`, 0–1, the loudest sample of the
 * last few milliseconds).
 */
export function mixerGraph(ctx, synth, destination = ctx.destination) {
  const master = strip(ctx, { pan: false });
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  master.output.connect(meter);
  meter.connect(destination);
  const strips = Array.from({ length: 16 }, (_, channel) => {
    const s = strip(ctx);
    s.output.connect(master.input);
    synth.connectChannel(s.input, channel);
    return s;
  });
  // The synthesizer's own reverb and chorus, to the master.
  synth.worklet.connect(master.input, 0);
  const samples = new Float32Array(meter.fftSize);
  return {
    master,
    strips,
    meter,
    apply(mix, channels) {
      channelSettings(mix, channels).forEach((s, channel) => strips[channel].apply(s, s.gain));
      master.apply(masterOf(mix));
    },
    level() {
      meter.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const x of samples) peak = Math.max(peak, Math.abs(x));
      return { peak };
    },
    /** Off the way out: an editor that is gone is no longer heard through it. */
    disconnect() {
      for (const node of [meter, master.output, ...strips.map((s) => s.output)]) {
        try {
          node.disconnect();
        } catch (error) {}
      }
    },
  };
}
